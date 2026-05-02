// Idempotent bootstrap for online AI opponents. Run from the cron handler
// every minute: ensures each bot tier has a player profile + persistent queue
// presence in casual (per gridSize) and ranked. Existing entries are
// refreshed so updatedAtMs stays current and the stale-prune sweep won't
// remove them. Player profile mu/sigma/rating are NOT touched if already
// present — bot ratings evolve from match results.

import {
  ALL_TIERS,
  BOT_DISPLAY,
  BOT_INITIAL_RATING,
  CASUAL_BOT_GRID_SIZES,
  botUidFor,
  casualBotQueueDocId,
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

  // 1. Profile docs — create only if missing; never overwrite an existing
  // bot profile so its rating can drift from match outcomes.
  for (const tier of ALL_TIERS) {
    const uid = botUidFor(tier);
    const existing = await getDocument(env, 'players', uid);
    if (existing) continue;
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
      updatedAt: nowIso
    });
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

    // Casual: one entry per supported grid size, all timer-on.
    for (const gridSize of CASUAL_BOT_GRID_SIZES) {
      const docId = casualBotQueueDocId(tier, gridSize);
      const existing = await getDocument(env, 'matchmakingQueue_casual', docId);
      const updateTime = existing?.updateTime;
      const entry = {
        ...entryBase,
        mode: 'casual',
        gridSize,
        timerEnabled: true
      };
      try {
        await writeDocument(env, 'matchmakingQueue_casual', docId, entry, updateTime);
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
