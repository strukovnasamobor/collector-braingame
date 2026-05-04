// Idempotent bootstrap for online AI opponents. Run from the cron handler
// every minute: ensures each bot tier has a player profile + persistent queue
// presence in standard (per gridSize) and ranked. Existing entries are
// refreshed so updatedAtMs stays current and the stale-prune sweep won't
// remove them. Player profile mu/sigma/rating are NOT touched if already
// present — bot ratings evolve from match results.

import {
  ALL_TIERS,
  BOT_DISPLAY,
  BOT_INITIAL_RATING,
  STANDARD_BOT_GRID_SIZES,
  botUidFor,
  standardBotQueueDocId,
  rankedBotQueueDocId
} from '../ai/bots';

// Display-rating → mu/sigma seeding mirrors the math in normalizeSkillProfile()
// in worker/src/index.js. We duplicate inline to avoid a circular import — this
// file is imported from index.js, so we can't import back.
const DEFAULT_SIGMA = 500;
const DISPLAY_DIVISOR = 2485;
const MAX_MU = 5000;

function muFromDisplay(displayRating) {
  const scaled = (Math.max(0, displayRating) * Math.LN2) / 1000;
  if (scaled === 0) return DEFAULT_SIGMA * 3;
  const conservative = DISPLAY_DIVISOR * Math.log(Math.expm1(scaled));
  return Math.min(MAX_MU, Math.max(0, conservative + 3 * DEFAULT_SIGMA));
}

export async function seedBots(env, helpers) {
  const { getDocument, writeDocument } = helpers;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. Profile docs — create if missing; otherwise backfill the Brain Gold
  // Coin economy fields without overwriting rating/W-D-L state. Bots get
  // every online grid unlocked since they need to be matchable on any size,
  // and coins default to 0 (rewards/penalties accumulate normally from
  // matches; bots aren't gated by their wallet for entry since ranked is
  // free to enter and bots are pre-unlocked on every board).
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
    // Existing bot doc — backfill economy fields if missing, leave the rest.
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
      // Race with another writer (concurrent cron tick or match finalize) —
      // harmless; the next tick will retry.
    }
  }

  // 2. Queue entries — UPSERT every cron tick to refresh updatedAtMs.
  // Read the bot's current profile so the queue carries up-to-date rating.
  for (const tier of ALL_TIERS) {
    const uid = botUidFor(tier);
    const profile = await getDocument(env, 'players', uid);
    const data = profile?.data || {};
    const entryBase = {
      uid,
      isBot: true,
      botTier: tier,
      displayName: BOT_DISPLAY[tier],
      mu: Number(data.mu) || muFromDisplay(BOT_INITIAL_RATING[tier]),
      sigma: Number(data.sigma) || DEFAULT_SIGMA,
      rating: Number(data.rating) || BOT_INITIAL_RATING[tier],
      status: 'searching',
      gameId: null,
      matchedWith: null,
      joinedAtMs: now,
      updatedAtMs: now,
      updatedAt: nowIso
    };

    // Standard: one entry per supported grid size, all timer-on.
    for (const gridSize of STANDARD_BOT_GRID_SIZES) {
      const docId = standardBotQueueDocId(tier, gridSize);
      const existing = await getDocument(env, 'matchmakingQueue_standard', docId);
      const updateTime = existing?.updateTime;
      const entry = {
        ...entryBase,
        mode: 'standard',
        gridSize,
        timerEnabled: true
      };
      try {
        await writeDocument(env, 'matchmakingQueue_standard', docId, entry, updateTime);
      } catch (_) {
        // Another writer raced; we'll catch up on the next tick.
      }
    }

    // Ranked: single canonical config (8x8 timer-on).
    const rankedDocId = rankedBotQueueDocId(tier);
    const existing = await getDocument(env, 'matchmakingQueue_ranked', rankedDocId);
    const updateTime = existing?.updateTime;
    const entry = {
      ...entryBase,
      mode: 'ranked',
      gridSize: 8,
      timerEnabled: true
    };
    try {
      await writeDocument(env, 'matchmakingQueue_ranked', rankedDocId, entry, updateTime);
    } catch (_) {
      // Race with another writer; harmless.
    }
  }
}
