// Self-contained search engine for the Collector AI — runtime-agnostic.
// Used by the browser Web Worker (src/game/aiSearch.worker.js) AND the
// Cloudflare Worker (imported via worker/src/ai/aiEngine.js). No DOM, no React,
// no Ionic, no Web Worker globals. Move-gen mirrors gameEngine.isValidPlacement /
// isValidElimination on flat arrays.
//
// The engine uses module-level mutable state for performance (avoids per-call
// allocation). This is safe because BOTH runtimes are single-threaded JS event
// loops AND chooseAIMove is fully synchronous — no other call can interleave.

import {
  AI_TIERS,
  ENDGAME_THRESHOLD,
  ENDGAME_SAFETY_MS,
  EVAL_BASIC_MATERIAL,
  EVAL_BASIC_LIBERTY,
  EVAL_BASIC_NEUTRAL_PEN,
  MCTS_C,
  RAVE_K,
  PW_ALPHA,
  WIN_MAG
} from './aiTiers';

const PLACE = 0;
const ELIMINATE = 1;
const FLAG_EXACT = 0;
const FLAG_LOWER = 1;
const FLAG_UPPER = 2;
const INF = 1e9;
const MAX_PLY = 64;
const MAX_DEPTH = 32;
const TT_CAP = 500_000;
const HISTORY_OVERFLOW = 1 << 28;
const ENDGAME_TT_DEPTH = 99;

// ── Per-search mutable state ───────────────────────────────────────────────
let size = 0;
let N2 = 0;
let cells = null;       // Int8Array, 0=empty, 1=P1, 2=P2
let dead = null;        // Uint8Array, 0/1
let phase = PLACE;
let side = 1;
let lastIdx = -1;
let hashLo = 0;
let hashHi = 0;

let tt = null;          // Map<string, { depth, value, flag, move }>
let history = null;     // Float64Array of size 4*N2
let killers = null;     // Int16Array MAX_PLY*2
let moveBufs = null;    // Array<Int16Array(N2)> per ply
let scoreBuf = null;    // Int32Array(N2) — scratch for ordering
let visitedBuf = null;  // Uint8Array(N2)
let stackBuf = null;    // Int16Array(N2)
let frontierBuf = null; // Uint8Array(N2)

let deadline = 0;
let timedOut = false;

// `currentEval` is set by the dispatch BEFORE each search to point at the
// right eval variant for the active tier.
let currentEval = null;

// ── Zobrist (per-worker, sized for the largest board we've seen) ───────────
let zN2 = 0;
let Z_CELL_LO = null;   // Int32Array of size 3*N2 — [P1 | P2 | DEAD]
let Z_CELL_HI = null;
let Z_LAST_LO = null;
let Z_LAST_HI = null;
let Z_PHASE_LO = 0;
let Z_PHASE_HI = 0;
let Z_SIDE_LO = 0;
let Z_SIDE_HI = 0;

function rand32() { return (Math.random() * 0x100000000) | 0; }

function ensureZobrist() {
  if (Z_CELL_LO && zN2 === N2) return;
  zN2 = N2;
  Z_CELL_LO = new Int32Array(3 * N2);
  Z_CELL_HI = new Int32Array(3 * N2);
  for (let i = 0; i < 3 * N2; i++) { Z_CELL_LO[i] = rand32(); Z_CELL_HI[i] = rand32(); }
  Z_LAST_LO = new Int32Array(N2);
  Z_LAST_HI = new Int32Array(N2);
  for (let i = 0; i < N2; i++) { Z_LAST_LO[i] = rand32(); Z_LAST_HI[i] = rand32(); }
  Z_PHASE_LO = rand32(); Z_PHASE_HI = rand32();
  Z_SIDE_LO = rand32();  Z_SIDE_HI = rand32();
}

function computeInitialHash() {
  hashLo = 0; hashHi = 0;
  for (let i = 0; i < N2; i++) {
    if (cells[i] === 1)      { hashLo ^= Z_CELL_LO[i];               hashHi ^= Z_CELL_HI[i]; }
    else if (cells[i] === 2) { hashLo ^= Z_CELL_LO[N2 + i];          hashHi ^= Z_CELL_HI[N2 + i]; }
    else if (dead[i])        { hashLo ^= Z_CELL_LO[2 * N2 + i];      hashHi ^= Z_CELL_HI[2 * N2 + i]; }
  }
  if (phase === ELIMINATE) {
    hashLo ^= Z_PHASE_LO; hashHi ^= Z_PHASE_HI;
    if (lastIdx >= 0) { hashLo ^= Z_LAST_LO[lastIdx]; hashHi ^= Z_LAST_HI[lastIdx]; }
  }
  if (side === 2) { hashLo ^= Z_SIDE_LO; hashHi ^= Z_SIDE_HI; }
}

// ── apply / undo ───────────────────────────────────────────────────────────
function applyPlace(idx) {
  cells[idx] = side;
  const sIdx = (side - 1) * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[idx];  hashHi ^= Z_LAST_HI[idx];
  lastIdx = idx;
  phase = ELIMINATE;
}

function undoPlace(idx) {
  cells[idx] = 0;
  const sIdx = (side - 1) * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[idx];  hashHi ^= Z_LAST_HI[idx];
  lastIdx = -1;
  phase = PLACE;
}

function applyEliminate(idx) {
  dead[idx] = 1;
  const sIdx = 2 * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_LAST_LO[lastIdx]; hashHi ^= Z_LAST_HI[lastIdx];
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  side = side === 1 ? 2 : 1;
  hashLo ^= Z_SIDE_LO;       hashHi ^= Z_SIDE_HI;
  lastIdx = -1;
  phase = PLACE;
}

function undoEliminate(idx, prevLastIdx) {
  hashLo ^= Z_SIDE_LO;       hashHi ^= Z_SIDE_HI;
  side = side === 1 ? 2 : 1;
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[prevLastIdx]; hashHi ^= Z_LAST_HI[prevLastIdx];
  lastIdx = prevLastIdx;
  dead[idx] = 0;
  const sIdx = 2 * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  phase = ELIMINATE;
}

// ── Move generation ────────────────────────────────────────────────────────
function hasAdjacentFreeIdx(idx) {
  const r = (idx / size) | 0;
  const c = idx - r * size;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const v = nr * size + nc;
      if (cells[v] === 0 && !dead[v]) return true;
    }
  }
  return false;
}

function genPlacements(buf) {
  let n = 0;
  for (let i = 0; i < N2; i++) {
    if (cells[i] !== 0 || dead[i]) continue;
    if (hasAdjacentFreeIdx(i)) buf[n++] = i;
  }
  return n;
}

function genEliminations(buf, lastI) {
  let n = 0;
  if (lastI < 0) return 0;
  const lr = (lastI / size) | 0;
  const lc = lastI - lr * size;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = lr + dr, c = lc + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const idx = r * size + c;
      if (cells[idx] === 0 && !dead[idx]) buf[n++] = idx;
    }
  }
  return n;
}

// ── Group helpers ──────────────────────────────────────────────────────────
function biggestGroup(player) {
  let best = 0;
  visitedBuf.fill(0);
  for (let start = 0; start < N2; start++) {
    if (cells[start] !== player || visitedBuf[start]) continue;
    let count = 0;
    let sp = 0;
    stackBuf[sp++] = start;
    visitedBuf[start] = 1;
    while (sp > 0) {
      const u = stackBuf[--sp];
      count++;
      const ur = (u / size) | 0;
      const uc = u - ur * size;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = ur + dr, nc = uc + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const v = nr * size + nc;
          if (!visitedBuf[v] && cells[v] === player) {
            visitedBuf[v] = 1;
            stackBuf[sp++] = v;
          }
        }
      }
    }
    if (count > best) best = count;
  }
  return best;
}

// Returns the size of player's biggest connected group AND the count of empty
// non-dead cells 8-adjacent to that specific group.
function biggestGroupSizeAndFrontier(player) {
  visitedBuf.fill(0);
  let bestSize = 0;
  let bestAnchor = -1;
  for (let start = 0; start < N2; start++) {
    if (cells[start] !== player || visitedBuf[start]) continue;
    let count = 0;
    let sp = 0;
    stackBuf[sp++] = start;
    visitedBuf[start] = 1;
    const anchor = start;
    while (sp > 0) {
      const u = stackBuf[--sp];
      count++;
      const ur = (u / size) | 0;
      const uc = u - ur * size;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = ur + dr, nc = uc + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const v = nr * size + nc;
          if (!visitedBuf[v] && cells[v] === player) {
            visitedBuf[v] = 1;
            stackBuf[sp++] = v;
          }
        }
      }
    }
    if (count > bestSize) { bestSize = count; bestAnchor = anchor; }
  }
  if (bestAnchor < 0) return { size: 0, frontier: 0 };

  visitedBuf.fill(0);
  frontierBuf.fill(0);
  let sp = 0;
  stackBuf[sp++] = bestAnchor;
  visitedBuf[bestAnchor] = 1;
  let frontier = 0;
  while (sp > 0) {
    const u = stackBuf[--sp];
    const ur = (u / size) | 0;
    const uc = u - ur * size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = ur + dr, nc = uc + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const v = nr * size + nc;
        if (visitedBuf[v]) continue;
        if (cells[v] === player) {
          visitedBuf[v] = 1;
          stackBuf[sp++] = v;
        } else if (cells[v] === 0 && !dead[v] && !frontierBuf[v]) {
          frontierBuf[v] = 1;
          frontier++;
        }
      }
    }
  }
  return { size: bestSize, frontier };
}

// ── Eval helpers ───────────────────────────────────────────────────────────
// Empty/non-dead cells 8-adjacent to ANY of player's dots, de-duplicated.
function totalLiberties(player) {
  let n = 0;
  frontierBuf.fill(0);
  for (let i = 0; i < N2; i++) {
    if (cells[i] !== player) continue;
    const r = (i / size) | 0;
    const c = i - r * size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const v = nr * size + nc;
        if (cells[v] === 0 && !dead[v] && !frontierBuf[v]) {
          frontierBuf[v] = 1;
          n++;
        }
      }
    }
  }
  return n;
}

// Count of dead cells with ≥1 8-neighbor of player (waste of own structure).
function neutralAdjacentToOwn(player) {
  let n = 0;
  for (let i = 0; i < N2; i++) {
    if (!dead[i]) continue;
    const r = (i / size) | 0;
    const c = i - r * size;
    let touches = false;
    for (let dr = -1; dr <= 1 && !touches; dr++) {
      for (let dc = -1; dc <= 1 && !touches; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (cells[nr * size + nc] === player) touches = true;
      }
    }
    if (touches) n++;
  }
  return n;
}

// ── Eval variants ──────────────────────────────────────────────────────────
function evalSimple() {
  return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
}

function evalBasic() {
  const opp = side === 1 ? 2 : 1;
  const my = biggestGroupSizeAndFrontier(side);
  const op = biggestGroupSizeAndFrontier(opp);
  const myLib = totalLiberties(side);
  const opLib = totalLiberties(opp);
  const myNeut = neutralAdjacentToOwn(side);
  const opNeut = neutralAdjacentToOwn(opp);
  return EVAL_BASIC_MATERIAL    * (my.size - op.size)
       + EVAL_BASIC_LIBERTY     * (myLib  - opLib)
       - EVAL_BASIC_NEUTRAL_PEN * (myNeut - opNeut);
}

const EVAL_BY_NAME = {
  simple: evalSimple,
  basic: evalBasic
};

function evaluate() { return currentEval(); }

// ── Adjacency / move-ordering primitives ───────────────────────────────────
function countAdjacentDots(idx, who) {
  const r = (idx / size) | 0;
  const c = idx - r * size;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (cells[nr * size + nc] === who) n++;
    }
  }
  return n;
}

function countAdjacentDead(idx) {
  const r = (idx / size) | 0;
  const c = idx - r * size;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (dead[nr * size + nc]) n++;
    }
  }
  return n;
}

function isGrabMove(m) {
  if (phase === PLACE) return countAdjacentDots(m, side) > 0;
  return countAdjacentDots(m, side === 1 ? 2 : 1) > 0;
}

function histIdx(s, p, m) {
  return ((s - 1) * 2 + p) * N2 + m;
}

function bumpHistory(s, p, m, depth) {
  const i = histIdx(s, p, m);
  history[i] += depth * depth;
  if (history[i] > HISTORY_OVERFLOW) {
    for (let k = 0; k < history.length; k++) history[k] = history[k] / 2;
  }
}

function pushKiller(ply, m) {
  const k0 = killers[ply * 2];
  if (k0 === m) return;
  killers[ply * 2 + 1] = k0;
  killers[ply * 2] = m;
}

function orderMoves(buf, n, ttMove, ply) {
  const phaseIdx = phase === ELIMINATE ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    let s = 0;
    if (m === ttMove) s += 10_000_000;
    if (isGrabMove(m)) s += 100_000 + 10 * countAdjacentDots(m, phase === PLACE ? side : (side === 1 ? 2 : 1));
    if (m === killers[ply * 2]) s += 50_000;
    if (m === killers[ply * 2 + 1]) s += 25_000;
    s += history[histIdx(side, phaseIdx, m)] | 0;
    scoreBuf[i] = s;
  }
  for (let i = 1; i < n; i++) {
    const m = buf[i], s = scoreBuf[i];
    let j = i - 1;
    while (j >= 0 && scoreBuf[j] < s) {
      buf[j + 1] = buf[j];
      scoreBuf[j + 1] = scoreBuf[j];
      j--;
    }
    buf[j + 1] = m;
    scoreBuf[j + 1] = s;
  }
}

// ── TT ─────────────────────────────────────────────────────────────────────
function ttKey() { return `${hashLo >>> 0}_${hashHi >>> 0}`; }

function ttStore(key, depth, value, flag, move) {
  if (tt.size > TT_CAP) {
    const target = (TT_CAP * 0.75) | 0;
    let toDrop = tt.size - target;
    for (const k of tt.keys()) {
      if (toDrop-- <= 0) break;
      tt.delete(k);
    }
  }
  tt.set(key, { depth, value, flag, move });
}

// ── Negamax (phase-aware: same side after place, toggles after eliminate) ──
function negamax(depth, alpha, beta, ply) {
  if (timedOut) return 0;
  if (performance.now() >= deadline) { timedOut = true; return 0; }
  if (ply >= MAX_PLY - 1) return evaluate();

  const buf = moveBufs[ply];
  let n;
  const wasPhase = phase;
  if (wasPhase === PLACE) {
    n = genPlacements(buf);
    if (n === 0) {
      const diff = biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
      const sgn = diff > 0 ? 1 : diff < 0 ? -1 : 0;
      return sgn * WIN_MAG + diff - ply;
    }
  } else {
    n = genEliminations(buf, lastIdx);
    if (n === 0) return evaluate();
  }

  const key = ttKey();
  const e = tt.get(key);
  let ttMove = -1;
  if (e && e.depth >= depth && e.depth !== ENDGAME_TT_DEPTH) {
    if (e.flag === FLAG_EXACT) return e.value;
    if (e.flag === FLAG_LOWER && e.value >= beta) return e.value;
    if (e.flag === FLAG_UPPER && e.value <= alpha) return e.value;
  }
  if (e) ttMove = e.move;

  if (depth <= 0) return evaluate();

  orderMoves(buf, n, ttMove, ply);

  let best = -INF;
  let bestMove = -1;
  const aOrig = alpha;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) v = negamax(depth - 1, alpha, beta, ply + 1);
    else v = -negamax(depth - 1, -beta, -alpha, ply + 1);
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return 0;

    if (v > best) { best = v; bestMove = m; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) {
      if (!isGrabMove(m)) {
        pushKiller(ply, m);
        bumpHistory(side, wasPhase === PLACE ? 0 : 1, m, depth);
      }
      break;
    }
  }

  const flag = best <= aOrig ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
  ttStore(key, depth, best, flag, bestMove);
  return best;
}

function searchRoot(depth) {
  const buf = moveBufs[0];
  const wasPhase = phase;
  let n;
  if (wasPhase === PLACE) n = genPlacements(buf);
  else n = genEliminations(buf, lastIdx);
  if (n === 0) return null;

  const key = ttKey();
  const e = tt.get(key);
  const ttMove = (e && e.move >= 0) ? e.move : -1;
  orderMoves(buf, n, ttMove, 0);

  let best = -INF;
  let bestMove = -1;
  const scores = new Map();
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) v = negamax(depth - 1, -INF, INF, 1);
    else v = -negamax(depth - 1, -INF, INF, 1);
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return null;
    scores.set(m, v);
    if (v > best) { best = v; bestMove = m; }
  }
  return { bestMove, bestValue: best, scores };
}

function runFixedAB(depth, timeMsCap) {
  deadline = performance.now() + (timeMsCap || 10000);
  timedOut = false;
  const r = searchRoot(depth);
  if (timedOut) return null;
  return r;
}

// ── 1-ply greedy (Beginner) ────────────────────────────────────────────────
function runOnePly() {
  const buf = moveBufs[0];
  const wasPhase = phase;
  const n = wasPhase === PLACE ? genPlacements(buf) : genEliminations(buf, lastIdx);
  if (n === 0) return null;
  const scores = new Map();
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    // Eval is from current side-to-move's perspective.
    // After Place: side unchanged → eval is from our perspective (no negation).
    // After Eliminate: side flipped → eval is from opp perspective → negate.
    const raw = evaluate();
    const v = wasPhase === PLACE ? raw : -raw;
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    scores.set(m, v);
  }
  let best = -INF;
  for (const v of scores.values()) if (v > best) best = v;
  return { bestMove: null, bestValue: best, scores };
}

// ── Endgame solver (Advanced only, terminal-only leaves) ───────────────────
function endgameNegamax(alpha, beta, ply) {
  if (timedOut) return 0;
  if (performance.now() >= deadline) { timedOut = true; return 0; }
  if (ply >= MAX_PLY - 1) {
    return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  }

  const buf = moveBufs[ply];
  let n;
  const wasPhase = phase;
  if (wasPhase === PLACE) {
    n = genPlacements(buf);
    if (n === 0) return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  } else {
    n = genEliminations(buf, lastIdx);
    if (n === 0) return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  }

  const key = ttKey();
  const e = tt.get(key);
  let ttMove = -1;
  if (e && e.depth === ENDGAME_TT_DEPTH) {
    if (e.flag === FLAG_EXACT) return e.value;
    if (e.flag === FLAG_LOWER && e.value >= beta) return e.value;
    if (e.flag === FLAG_UPPER && e.value <= alpha) return e.value;
  }
  if (e) ttMove = e.move;

  orderMoves(buf, n, ttMove, ply);

  let best = -INF;
  let bestMove = -1;
  const aOrig = alpha;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) v = endgameNegamax(alpha, beta, ply + 1);
    else v = -endgameNegamax(-beta, -alpha, ply + 1);
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return 0;
    if (v > best) { best = v; bestMove = m; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  const flag = best <= aOrig ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
  ttStore(key, ENDGAME_TT_DEPTH, best, flag, bestMove);
  return best;
}

function endgameRoot() {
  const buf = moveBufs[0];
  const wasPhase = phase;
  let n;
  if (wasPhase === PLACE) n = genPlacements(buf);
  else n = genEliminations(buf, lastIdx);
  if (n === 0) return null;

  orderMoves(buf, n, -1, 0);

  let best = -INF;
  let bestMove = -1;
  const scores = new Map();
  let alpha = -INF;
  const beta = INF;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) v = endgameNegamax(alpha, beta, 1);
    else v = -endgameNegamax(-beta, -alpha, 1);
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return null;
    scores.set(m, v);
    if (v > best) { best = v; bestMove = m; }
    if (v > alpha) alpha = v;
  }
  return { bestMove, bestValue: best, scores };
}

function runEndgame() {
  const t0 = performance.now();
  deadline = t0 + ENDGAME_SAFETY_MS;
  timedOut = false;
  const result = endgameRoot();
  if (timedOut) return null;
  return result;
}

// ── MCTS + RAVE + progressive widening (Advanced) ──────────────────────────
// Heavy rollout/ordering policy weights.
function heavyWeight(idx, ph, who) {
  const opp = who === 1 ? 2 : 1;
  if (ph === PLACE) {
    const ownAdj = countAdjacentDots(idx, who);
    const oppAdj = countAdjacentDots(idx, opp);
    const deadAdj = countAdjacentDead(idx);
    return Math.max(0.1, 1 + 3 * ownAdj + 2 * oppAdj - 2 * deadAdj);
  }
  // ELIMINATE
  const ownAdj = countAdjacentDots(idx, who);
  const oppAdj = countAdjacentDots(idx, opp);
  return Math.max(0.1, 1 + 4 * oppAdj - 2 * ownAdj);
}

// Weighted random pick from `arr` of length `n`, weights computed via heavyWeight.
function pickWeighted(arr, n, ph, who) {
  let total = 0;
  for (let i = 0; i < n; i++) total += heavyWeight(arr[i], ph, who);
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) {
    const w = heavyWeight(arr[i], ph, who);
    r -= w;
    if (r <= 0) return arr[i];
  }
  return arr[n - 1];
}

function makeMctsNode(parent, move, toMove, nodePhase) {
  return {
    parent,
    move,
    toMove,
    phase: nodePhase,
    untriedSorted: null,
    untriedCount: 0,
    children: null,
    visits: 0,
    totalScore: 0
  };
}

// Shared scratch for moveBuf generation during MCTS expansion (no recursion).
let mctsGenBuf = null;

// Populate node.untriedSorted lazily, sorted DESC by heavy policy weight.
// `untriedSorted` stores moves in DESC order; we pop from the FRONT to expand
// best-policy first.
function ensureUntried(node) {
  if (node.untriedSorted !== null) return;
  const buf = mctsGenBuf;
  const n = node.phase === PLACE ? genPlacements(buf) : genEliminations(buf, lastIdx);
  if (n === 0) {
    node.untriedSorted = new Int16Array(0);
    node.untriedCount = 0;
    node.children = [];
    return;
  }
  // sort buf[0..n] by heavy policy DESC (uses shared scoreBuf as scratch)
  for (let i = 0; i < n; i++) {
    scoreBuf[i] = Math.round(heavyWeight(buf[i], node.phase, node.toMove) * 1000) | 0;
  }
  for (let i = 1; i < n; i++) {
    const m = buf[i], s = scoreBuf[i];
    let j = i - 1;
    while (j >= 0 && scoreBuf[j] < s) {
      buf[j + 1] = buf[j];
      scoreBuf[j + 1] = scoreBuf[j];
      j--;
    }
    buf[j + 1] = m;
    scoreBuf[j + 1] = s;
  }
  // Copy only the first n entries (right-sized).
  node.untriedSorted = buf.slice(0, n);
  node.untriedCount = n;
  node.children = [];
}

// AMAF (per-search). Index = ((side-1)*2 + phase) * N2 + cellIdx.
let amafScore = null;
let amafVisits = null;
let amafSeen = null;       // Uint8Array(4*N2), reset per simulation
let amafSeenList = null;   // Int32Array(4*N2*2), tracks indices touched per sim
let amafSeenCount = 0;

function amafIdx(s, ph, m) { return ((s - 1) * 2 + ph) * N2 + m; }

function amafTouch(s, ph, m) {
  const i = amafIdx(s, ph, m);
  if (!amafSeen[i]) {
    amafSeen[i] = 1;
    amafSeenList[amafSeenCount++] = i;
  }
}

function amafResetSeen() {
  for (let k = 0; k < amafSeenCount; k++) amafSeen[amafSeenList[k]] = 0;
  amafSeenCount = 0;
}

// UCT-RAVE blend score for child (from parent's perspective).
// AMAF is keyed by (mover, move-phase, cell). For an edge parent→child, the
// mover is parent.toMove and the move-phase is parent.phase (the phase AT the
// time the move was played, before it was applied).
function uctRaveScore(child, parent) {
  const cv = child.visits;
  if (cv === 0) return Infinity;
  const uctMean = (child.toMove === parent.toMove
    ? child.totalScore / cv
    : -child.totalScore / cv);
  const ai = amafIdx(parent.toMove, parent.phase, child.move);
  const av = amafVisits[ai];
  const amafMean = av > 0 ? amafScore[ai] / av : 0;
  const beta = Math.sqrt(RAVE_K / (3 * cv + RAVE_K));
  const exploit = (1 - beta) * uctMean + beta * amafMean;
  const explore = MCTS_C * Math.sqrt(Math.log(parent.visits) / cv);
  return exploit + explore;
}

function expandOne(node) {
  // Pop best untried (front of sorted list, since DESC)
  const m = node.untriedSorted[0];
  for (let i = 1; i < node.untriedCount; i++) node.untriedSorted[i - 1] = node.untriedSorted[i];
  node.untriedCount--;

  const wasPhase = phase;
  const savedLastIdx = lastIdx;
  if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
  const child = makeMctsNode(node, m, side, phase);
  node.children.push(child);
  return { child, move: m, wasPhase, savedLastIdx };
}

// Run one MCTS simulation from `root`.
// State is mutated; everything is undone before returning.
const mctsSelStack = []; // { move, wasPhase, savedLastIdx }
const mctsRollStack = []; // { move, wasPhase, savedLastIdx }

function runOneMctsSim(root) {
  mctsSelStack.length = 0;
  mctsRollStack.length = 0;
  amafResetSeen();

  // SELECTION + (in-loop) EXPANSION
  let node = root;
  let path = [root];
  while (true) {
    ensureUntried(node);
    // Terminal check: no untried AND no children means no legal moves here.
    if (node.untriedCount === 0 && node.children.length === 0) break;

    const cap = Math.max(1, Math.ceil(Math.pow(Math.max(1, node.visits), PW_ALPHA)));
    if (node.children.length < cap && node.untriedCount > 0) {
      // EXPAND
      const r = expandOne(node);
      mctsSelStack.push({ move: r.move, wasPhase: r.wasPhase, savedLastIdx: r.savedLastIdx });
      amafTouch(node.toMove, r.wasPhase, r.move);
      path.push(r.child);
      node = r.child;
      break; // expanded — proceed to rollout
    }

    // SELECT existing child via UCT-RAVE
    let best = -Infinity;
    let bestChild = null;
    for (const c of node.children) {
      const sc = uctRaveScore(c, node);
      if (sc > best) { best = sc; bestChild = c; }
    }
    if (bestChild === null) break;
    const wasPhase = phase;
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(bestChild.move); else applyEliminate(bestChild.move);
    mctsSelStack.push({ move: bestChild.move, wasPhase, savedLastIdx });
    amafTouch(node.toMove, wasPhase, bestChild.move);
    node = bestChild;
    path.push(node);
  }

  // ROLLOUT — until terminal or safety cap
  const ROLL_CAP = 2 * N2;
  let plyCount = 0;
  while (plyCount < ROLL_CAP) {
    const buf = moveBufs[0]; // safe — selection/expansion no longer descending recursively
    let n;
    const wasPhase = phase;
    if (wasPhase === PLACE) n = genPlacements(buf);
    else n = genEliminations(buf, lastIdx);
    if (n === 0) break;
    const m = pickWeighted(buf, n, wasPhase, side);
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    mctsRollStack.push({ move: m, wasPhase, savedLastIdx });
    amafTouch(wasPhase === PLACE ? (side) : (side === 1 ? 2 : 1), wasPhase, m);
    // Note: wasPhase=PLACE means the mover was current `side` (no toggle yet).
    // wasPhase=ELIMINATE means the mover was the OPPOSITE side after our toggle.
    // The amafTouch call handles that by computing the mover.
    plyCount++;
  }

  // Compute final result from leaf side-to-move's perspective: ∈ {-1, 0, +1}.
  const myFinal = biggestGroup(side);
  const opFinal = biggestGroup(side === 1 ? 2 : 1);
  const leafResult = myFinal > opFinal ? 1 : myFinal < opFinal ? -1 : 0;

  // BACKPROP — walk path leaf→root, flipping when child.toMove !== node.toMove.
  let s = leafResult;
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i];
    n.visits++;
    n.totalScore += s;
    if (i > 0) {
      const parent = path[i - 1];
      if (parent.toMove !== n.toMove) s = -s;
    }
  }

  // Update AMAF: every touched (side, phase, move) gets the result aligned with
  // its mover's perspective. amafScore is summed signed by mover side. Since
  // we recorded each (mover, phase, move), we want to add `result_for_mover`.
  // Compute mover's result by finding result aligned to mover's perspective.
  // Simplification: we add `leafResult` flipped to mover's side perspective.
  // The leaf side's perspective is `leafResult`. For a mover whose toMove ===
  // leafSide, add `leafResult`. For a mover with toMove !== leafSide, add `-leafResult`.
  // amafSeenList stores indices = ((mover-1)*2 + phase) * N2 + move; we can decode mover.
  const leafSide = side; // current side AT the leaf (we're at leaf state right now)
  for (let k = 0; k < amafSeenCount; k++) {
    const idx = amafSeenList[k];
    const mover = ((idx / N2) | 0) >> 1; // ((idx/N2) | 0) = (mover-1)*2 + phase; >>1 = mover-1
    const moverSide = mover + 1;
    const sign = (moverSide === leafSide) ? 1 : -1;
    amafScore[idx] += sign * leafResult;
    amafVisits[idx] += 1;
  }

  // UNDO rollout, then selection.
  while (mctsRollStack.length > 0) {
    const { move: m, wasPhase, savedLastIdx } = mctsRollStack.pop();
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
  }
  while (mctsSelStack.length > 0) {
    const { move: m, wasPhase, savedLastIdx } = mctsSelStack.pop();
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
  }
}

function runMCTSRave(cfg) {
  const root = makeMctsNode(null, -1, side, phase);
  amafScore = new Float64Array(4 * N2);
  amafVisits = new Int32Array(4 * N2);
  amafSeen = new Uint8Array(4 * N2);
  amafSeenList = new Int32Array(4 * N2);
  amafSeenCount = 0;

  deadline = performance.now() + cfg.timeMs;
  timedOut = false;
  let sims = 0;
  const cap = cfg.simBudget || 100000;
  while (sims < cap) {
    if (performance.now() >= deadline) { timedOut = true; break; }
    runOneMctsSim(root);
    sims++;
  }

  if (!root.children || root.children.length === 0) return null;
  // Robust child: most-visited.
  let bestChild = root.children[0];
  for (const c of root.children) {
    if (c.visits > bestChild.visits) bestChild = c;
  }
  // Build a `scores` Map for randomization compatibility (visit-counts as score).
  const scores = new Map();
  for (const c of root.children) scores.set(c.move, c.visits);
  return { bestMove: bestChild.move, bestValue: bestChild.visits, scores };
}

// ── Top-level dispatch + tie-break randomization ───────────────────────────
function pickEps(scores, eps, epsMin) {
  if (!scores || scores.size === 0) return null;
  let best = -INF;
  for (const v of scores.values()) if (v > best) best = v;
  const tol = Math.max(epsMin, Math.abs(best) * eps);
  const pool = [];
  for (const [m, v] of scores) {
    if (v >= best - tol) pool.push(m);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function countEmpty() {
  let n = 0;
  for (let i = 0; i < N2; i++) if (cells[i] === 0 && !dead[i]) n++;
  return n;
}

function chooseMove(cfg) {
  // Set the eval pointer for tiers that use one
  currentEval = EVAL_BY_NAME[cfg.evalName] || evalBasic;

  if (cfg.kind === 'oneply') {
    const r = runOnePly();
    return pickEps(r?.scores, 0, 0);
  }
  if (cfg.kind === 'fixedab') {
    const r = runFixedAB(cfg.depth, cfg.timeMs);
    return pickEps(r?.scores, 0, 0);
  }
  if (cfg.kind === 'mctsrave') {
    if (cfg.endgame && countEmpty() <= ENDGAME_THRESHOLD) {
      const r = runEndgame();
      if (r) return pickEps(r.scores, 0, 0);
      // fall through to MCTS if endgame timed out
    }
    const r = runMCTSRave(cfg);
    return pickEps(r?.scores, 0, 0);
  }
  return null;
}

// ── State init from input message ──────────────────────────────────────────
function initFromState(stateInput, gridSize, pPhase, lastPlaces, currentPlayer) {
  size = gridSize;
  N2 = size * size;
  cells = new Int8Array(N2);
  dead = new Uint8Array(N2);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const idx = r * size + c;
      const cell = stateInput[r][c];
      cells[idx] = cell.player === 1 ? 1 : cell.player === 2 ? 2 : 0;
      dead[idx] = cell.eliminated ? 1 : 0;
    }
  }
  phase = pPhase === 'eliminate' ? ELIMINATE : PLACE;
  side = currentPlayer === 2 ? 2 : 1;
  lastIdx = (phase === ELIMINATE && lastPlaces)
    ? lastPlaces.row * size + lastPlaces.col
    : -1;

  ensureZobrist();
  computeInitialHash();

  tt = new Map();
  history = new Float64Array(2 * 2 * N2);
  killers = new Int16Array(MAX_PLY * 2);
  killers.fill(-1);
  moveBufs = new Array(MAX_PLY);
  for (let p = 0; p < MAX_PLY; p++) moveBufs[p] = new Int16Array(N2);
  scoreBuf = new Int32Array(N2);
  visitedBuf = new Uint8Array(N2);
  stackBuf = new Int16Array(N2);
  frontierBuf = new Uint8Array(N2);
  mctsGenBuf = new Int16Array(N2);
  timedOut = false;
}

// ── Public API ─────────────────────────────────────────────────────────────
// Synchronous; returns { row, col } or null. The caller is responsible for
// handling timing (this runs to completion within the tier's time budget,
// enforced internally via deadline + timedOut).
export function chooseAIMove({ tier, state: stateInput, size: gridSize, phase: pPhase, lastPlaces, currentPlayer }) {
  const cfg = AI_TIERS[tier];
  if (!cfg) return null;
  initFromState(stateInput, gridSize, pPhase, lastPlaces, currentPlayer);
  const moveIdx = chooseMove(cfg);
  if (moveIdx === null || moveIdx === undefined || moveIdx < 0) return null;
  const r = (moveIdx / size) | 0;
  const c = moveIdx - r * size;
  return { row: r, col: c };
}
