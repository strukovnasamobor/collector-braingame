// Per-game ingestion path. Hooked into finalizeMatchCleanup; runs for every
// game that ends, regardless of who played. Quality-filters the game, replays
// the placement history to derive book + MAST samples, mutates the cached
// `assimilator/state` doc, and writes it back to Firestore with an updateTime
// precondition. On precondition conflict (a concurrent writer beat us to the
// punch) we retry exactly once with a fresh read; further conflicts are
// dropped — the weekly learn job rebuilds policy weights from scratch
// anyway, and an occasional missed book/MAST sample isn't worth burning
// subrequests on.

import {
  getAssimilatorState,
  getAssimilatorUpdateTime,
  invalidateAssimilatorState,
  setCachedAssimilatorState,
  ASSIMILATOR_STATE_COLLECTION,
  ASSIMILATOR_STATE_DOC_ID
} from './state';
import { qualityFilterRejection } from './qualityFilter';
import {
  buildBookKey,
  recordBookSample,
  OPENING_BOOK_MAX_PLACEMENTS
} from './openingBook';
import { recordMastSamples, MAST_PHASE_PLACE } from './mast';

// The placementHistory schema stores entries as { r, c }. Convert to a flat
// idx via row * size + col.
function placementToIdx(p, size) {
  if (!p || !Number.isInteger(p.r) || !Number.isInteger(p.c)) return -1;
  if (p.r < 0 || p.r >= size || p.c < 0 || p.c >= size) return -1;
  return p.r * size + p.c;
}

// Outcome string from each side's perspective given the result.winner.
function outcomeFor(side, winner) {
  if (winner === 0) return 'draw';
  return winner === side ? 'win' : 'loss';
}

// Replay placements alternating p1, p2. For each placement we capture the
// pre-placement cells state and the move idx, then advance. Returns
// { bookSamples: [{ size, key, move, outcome }], mastSamples: [{ side, phase, move, outcome }] }.
function buildSamplesFromGame(game) {
  const size = Number(game.gridSize) || 0;
  if (!Number.isInteger(size) || size < 4 || size > 12) return { bookSamples: [], mastSamples: [] };
  const N2 = size * size;
  const ph = game.placementHistory || { p1: [], p2: [] };
  const p1Moves = Array.isArray(ph.p1) ? ph.p1 : [];
  const p2Moves = Array.isArray(ph.p2) ? ph.p2 : [];
  const winner = Number(game.result?.winner);
  if (![0, 1, 2].includes(winner)) return { bookSamples: [], mastSamples: [] };

  const cells = new Int8Array(N2);
  const bookSamples = [];
  const mastSamples = [];
  // Total placement count (for book horizon gate). Only place-phase entries
  // here, but keep the counter side-symmetric (each side's k-th placement is
  // at total = 2k-1 for p1 / 2k for p2).
  let placementCount = 0;
  const turns = Math.max(p1Moves.length, p2Moves.length);
  for (let t = 0; t < turns; t++) {
    // Player 1 plays first within the turn.
    const p1Idx = t < p1Moves.length ? placementToIdx(p1Moves[t], size) : -1;
    if (p1Idx >= 0) {
      const outcome = outcomeFor(1, winner);
      mastSamples.push({ side: 1, phase: MAST_PHASE_PLACE, move: p1Idx, outcome });
      if (placementCount < OPENING_BOOK_MAX_PLACEMENTS) {
        const key = buildBookKey(size, 1, cells);
        bookSamples.push({ size, key, move: p1Idx, outcome });
      }
      cells[p1Idx] = 1;
      placementCount++;
    }
    const p2Idx = t < p2Moves.length ? placementToIdx(p2Moves[t], size) : -1;
    if (p2Idx >= 0) {
      const outcome = outcomeFor(2, winner);
      mastSamples.push({ side: 2, phase: MAST_PHASE_PLACE, move: p2Idx, outcome });
      if (placementCount < OPENING_BOOK_MAX_PLACEMENTS) {
        const key = buildBookKey(size, 2, cells);
        bookSamples.push({ size, key, move: p2Idx, outcome });
      }
      cells[p2Idx] = 2;
      placementCount++;
    }
  }
  return { bookSamples, mastSamples };
}

// Public entry point. Best-effort: returns { ingested: bool, reason?: string }.
// Never throws — all errors are logged and swallowed so a Firestore hiccup
// can't break finalizeMatchCleanup's main job (flipping queue states / coin
// awards).
export async function ingestFinishedGame(env, helpers, game) {
  const { getDocument, writeDocument } = helpers;
  const reject = qualityFilterRejection(game);
  if (reject) return { ingested: false, reason: reject };

  const { bookSamples, mastSamples } = buildSamplesFromGame(game);
  if (bookSamples.length === 0 && mastSamples.length === 0) {
    return { ingested: false, reason: 'no-samples' };
  }
  const sizeKey = String(Number(game.gridSize) || 0);

  for (let attempt = 0; attempt < 2; attempt++) {
    let state;
    try {
      state = await getAssimilatorState(env, getDocument, { forceFresh: attempt > 0 });
    } catch (err) {
      console.warn('[assimilator-ingest] state read failed', err?.message);
      return { ingested: false, reason: 'state-read-failed' };
    }
    if (!state.book) state.book = {};
    if (!state.mast) state.mast = {};
    if (!state.book[sizeKey]) state.book[sizeKey] = {};
    if (!state.mast[sizeKey]) state.mast[sizeKey] = {};

    // Clone shallowly so a write failure doesn't leave half-applied mutations
    // in the cache.
    const nextBookForSize = { ...(state.book[sizeKey] || {}) };
    const nextMastForSize = { ...(state.mast[sizeKey] || {}) };
    for (const s of bookSamples) {
      recordBookSample(nextBookForSize, s.key, s.move, s.outcome);
    }
    recordMastSamples(nextMastForSize, mastSamples);

    const nextState = {
      ...state,
      book: { ...state.book, [sizeKey]: nextBookForSize },
      mast: { ...state.mast, [sizeKey]: nextMastForSize },
      updatedAt: new Date().toISOString()
    };

    const updateTime = getAssimilatorUpdateTime();
    try {
      const written = await writeDocument(
        env,
        ASSIMILATOR_STATE_COLLECTION,
        ASSIMILATOR_STATE_DOC_ID,
        nextState,
        updateTime || undefined
      );
      setCachedAssimilatorState(nextState, written?.updateTime || null);
      console.log(
        `[assimilator-ingest] passed quality filter — recorded ${bookSamples.length} book / ${mastSamples.length} MAST samples (size ${sizeKey})`
      );
      return { ingested: true, bookSamples: bookSamples.length, mastSamples: mastSamples.length };
    } catch (err) {
      const msg = String(err?.message || '');
      // Firestore precondition failure = concurrent writer; retry once with
      // a fresh read so the next attempt's nextState is built off the latest
      // committed snapshot.
      if (attempt === 0 && /precondition|FAILED_PRECONDITION|409/i.test(msg)) {
        invalidateAssimilatorState();
        continue;
      }
      console.warn('[assimilator-ingest] write failed', msg);
      return { ingested: false, reason: 'write-failed' };
    }
  }
  return { ingested: false, reason: 'precondition-retry-exhausted' };
}
