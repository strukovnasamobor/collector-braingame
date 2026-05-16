// Bot-related constants for the online AI opponents. Imported by the worker
// (matchmaking, seeding, MatchBot DO).

import { TIER_ORDER, TIER_BOARD_SIZES } from './aiTiers';

export const BOT_UID_PREFIX = 'bot:';
export const botUidFor = (tier) => `${BOT_UID_PREFIX}${tier}`;
export const isBotUid = (uid) => typeof uid === 'string' && uid.startsWith(BOT_UID_PREFIX);
export const tierFromBotUid = (uid) => isBotUid(uid) ? uid.slice(BOT_UID_PREFIX.length) : null;

export const BOT_DISPLAY = {
  connector:   'Connector 🤖',
  concentrator:'Concentrator 🤖',
  constructor: 'Constructor 🤖',
  coordinator: 'Coordinator 🤖',
  confiscator: 'Confiscator 🤖',
  conservator: 'Conservator 🤖',
  cumulator:   'Cumulator 🤖',
  collector:   'Collector 🤖',
  curator:     'Curator 🤖',
  cogitator:   'Cogitator 🤖'
};

// All bots start at the same rating (1000) and let the live Elo system separate
// them through actual play. Pre-tuned per-tier initial ratings were a relic of
// the old oneply/fixedab/mctsrave ladder; now that all five tiers share the
// MCTS-RAVE engine and only differ in rollout policy / learning, the initial
// strength gap is small enough that observed Elo is the right source of truth.
export const BOT_INITIAL_RATING = {
  connector:   1000,
  concentrator:1000,
  constructor: 1000,
  coordinator: 1000,
  confiscator: 1000,
  conservator: 1000,
  cumulator:   1000,
  collector:   1000,
  curator:     1000,
  cogitator:   1000
};

// Standard gridSizes that bots maintain queue presence for. Online play always
// uses the 30 s turn timer, so we don't need timer-off variants.
export const STANDARD_BOT_GRID_SIZES = [6, 8, 10];

// Composite queue-doc id for a standard bot entry: `bot:confiscator_8` etc.
// Ranked has only one valid config (8x8 timer-on), so we use plain `bot:confiscator`.
export const standardBotQueueDocId = (tier, gridSize) => `${botUidFor(tier)}_${gridSize}`;
export const rankedBotQueueDocId = (tier) => botUidFor(tier);

export const ALL_TIERS = TIER_ORDER;

// Per-tier grid eligibility: cogitator (puctaz) is only usable on 8×8 because
// the trained ONNX model has size 8 baked in. The matchmaker uses this to
// skip ineligible tiers when picking the closest-fit bot for the player's
// chosen grid size.
export function tierAvailableForGrid(tier, gridSize) {
  const restriction = TIER_BOARD_SIZES[tier];
  if (!Array.isArray(restriction)) return true;  // no restriction → always available
  return restriction.includes(gridSize);
}
