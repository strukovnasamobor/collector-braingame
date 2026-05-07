// Idempotent profile bootstrap for online AI opponents. Called from
// /matchmaking/run before bot synthesis; gated by a module-level flag so
// the work happens at most once per worker isolate. The flag survives
// across requests within the same isolate (Cloudflare Workers module
// scope), so steady-state cost is zero — only cold-start pays the
// presence-check reads.
//
// Bots no longer have matchmaking queue documents — they're synthesized
// in-memory by /matchmaking/run from constants in ../ai/bots. This file
// is responsible only for the player profile docs (`players/bot:{tier}`)
// which carry rating, W-D-L counters, and the Brain Gold Coin economy
// fields. Existing profile mu/sigma/rating are NOT touched if already
// present — bot ratings evolve from match results.

import { ALL_TIERS, BOT_DISPLAY, BOT_INITIAL_RATING, botUidFor } from '../ai/bots';
import {
  getAssimilatorState,
  setCachedAssimilatorState,
  ASSIMILATOR_STATE_COLLECTION,
  ASSIMILATOR_STATE_DOC_ID
} from '../ai/assimilator/state';

const DEFAULT_SIGMA = 500;
const DISPLAY_DIVISOR = 2485;
const MAX_MU = 5000;

function muFromDisplay(displayRating) {
  const scaled = (Math.max(0, displayRating) * Math.LN2) / 1000;
  if (scaled === 0) return DEFAULT_SIGMA * 3;
  const conservative = DISPLAY_DIVISOR * Math.log(Math.expm1(scaled));
  return Math.min(MAX_MU, Math.max(0, conservative + 3 * DEFAULT_SIGMA));
}

let bootstrapped = false;

export async function ensureBotProfilesOnce(env, helpers) {
  if (bootstrapped) return;
  const { getDocument, writeDocument } = helpers;
  const nowIso = new Date().toISOString();
  const ALL_GRIDS = [6, 8, 10, 12];

  // One-shot bot rating reset (v1.0). Earlier deploys seeded captor=1500,
  // hoarder=1700, collector=1900 to encode expected strength; v1.0 flattens
  // every tier to BOT_INITIAL_RATING (1000) and lets the live Elo system
  // separate them through play. The reset is idempotent — it's gated on the
  // `botRatingsResetAt` field of `assimilator/state`. Once set, the
  // migration never re-runs on any isolate.
  let needsRatingReset = false;
  try {
    const state = await getAssimilatorState(env, getDocument);
    needsRatingReset = !state.botRatingsResetAt;
  } catch (err) {
    console.warn('[seedBots] assimilator state read failed; skipping rating reset', err?.message);
  }

  for (const tier of ALL_TIERS) {
    const uid = botUidFor(tier);
    const initialRating = BOT_INITIAL_RATING[tier];
    const existing = await getDocument(env, 'players', uid);
    if (!existing) {
      const mu = muFromDisplay(initialRating);
      await writeDocument(env, 'players', uid, {
        displayName: BOT_DISPLAY[tier],
        mu,
        sigma: DEFAULT_SIGMA,
        rating: initialRating,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        state: 'idle',
        isBot: true,
        botTier: tier,
        coins: 0,
        unlocks: { onlineGrids: ALL_GRIDS },
        updatedAt: nowIso
      });
      continue;
    }
    const data = existing.data || {};
    const hasCoins = Number.isFinite(Number(data.coins));
    const grids = Array.isArray(data.unlocks?.onlineGrids)
      ? data.unlocks.onlineGrids.map(Number).filter((n) => Number.isFinite(n))
      : [];
    const hasAllGrids = ALL_GRIDS.every((g) => grids.includes(g));
    const ratingMismatch = needsRatingReset && Number(data.rating) !== initialRating;
    if (hasCoins && hasAllGrids && !ratingMismatch) continue;
    const updates = {
      ...data,
      coins: hasCoins ? Number(data.coins) : 0,
      unlocks: { onlineGrids: ALL_GRIDS },
      updatedAt: nowIso
    };
    if (ratingMismatch) {
      updates.mu = muFromDisplay(initialRating);
      updates.sigma = DEFAULT_SIGMA;
      updates.rating = initialRating;
      // Reset W/D/L too so the visible record matches the new rating.
      // Existing match histories in `games/` are preserved — only the
      // aggregated counters on the player profile are zeroed.
      updates.games = 0;
      updates.wins = 0;
      updates.losses = 0;
      updates.draws = 0;
    }
    try {
      await writeDocument(env, 'players', uid, updates, existing.updateTime);
    } catch (_) {
      // Race with another writer — harmless; the next cold-start will retry.
    }
  }

  // Mark the migration as done so future isolates skip the reset path. Best-
  // effort: if this write fails, the worst case is that the next /run on a
  // cold isolate re-runs an already-idempotent reset.
  if (needsRatingReset) {
    try {
      const state = await getAssimilatorState(env, getDocument);
      const next = { ...state, botRatingsResetAt: nowIso, updatedAt: nowIso };
      const written = await writeDocument(
        env,
        ASSIMILATOR_STATE_COLLECTION,
        ASSIMILATOR_STATE_DOC_ID,
        next
      );
      setCachedAssimilatorState(next, written?.updateTime || null);
    } catch (err) {
      console.warn('[seedBots] failed to mark botRatingsResetAt', err?.message);
    }
  }

  bootstrapped = true;
}
