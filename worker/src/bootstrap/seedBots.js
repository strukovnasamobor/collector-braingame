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

  for (const tier of ALL_TIERS) {
    const uid = botUidFor(tier);
    const existing = await getDocument(env, 'players', uid);
    if (!existing) {
      const initialRating = BOT_INITIAL_RATING[tier];
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
    if (hasCoins && hasAllGrids) continue;
    try {
      await writeDocument(env, 'players', uid, {
        ...data,
        coins: hasCoins ? Number(data.coins) : 0,
        unlocks: { onlineGrids: ALL_GRIDS },
        updatedAt: nowIso
      }, existing.updateTime);
    } catch (_) {
      // Race with another writer — harmless; the next cold-start will retry.
    }
  }

  bootstrapped = true;
}
