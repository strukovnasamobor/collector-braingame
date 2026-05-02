// Bot-related constants for the online AI opponents. Imported by the worker
// (matchmaking, seeding, MatchBot DO).

import { TIER_ORDER } from './aiTiers';

export const BOT_UID_PREFIX = 'bot:';
export const botUidFor = (tier) => `${BOT_UID_PREFIX}${tier}`;
export const isBotUid = (uid) => typeof uid === 'string' && uid.startsWith(BOT_UID_PREFIX);
export const tierFromBotUid = (uid) => isBotUid(uid) ? uid.slice(BOT_UID_PREFIX.length) : null;

export const BOT_DISPLAY = {
  seeker:    'Seeker 🤖',
  hunter:    'Hunter 🤖',
  collector: 'Collector 🤖'
};

// Initial display ratings per tier — chosen so a default 1000-rated human
// will be paired closest to Hunter at first; ladder spans ~800 points.
export const BOT_INITIAL_RATING = {
  seeker:    1000,
  hunter:    1400,
  collector: 1800
};

// Standard gridSizes that bots maintain queue presence for. Online play always
// uses the 30 s turn timer, so we don't need timer-off variants.
export const STANDARD_BOT_GRID_SIZES = [6, 8, 10, 12];

// Composite queue-doc id for a standard bot entry: `bot:hunter_8` etc.
// Ranked has only one valid config (8x8 timer-on), so we use plain `bot:hunter`.
export const standardBotQueueDocId = (tier, gridSize) => `${botUidFor(tier)}_${gridSize}`;
export const rankedBotQueueDocId = (tier) => botUidFor(tier);

export const ALL_TIERS = TIER_ORDER;
