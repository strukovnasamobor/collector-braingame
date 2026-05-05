// Per-isolate cache of bot player profiles. Bots have no queue docs;
// matchmaking synthesizes virtual candidates and reads ratings here.
//
// Pass { forceFresh: true } to bypass the cache for read paths where
// staleness is observable — namely ranked matchmaking, which selects the
// opponent by closest display rating. Cloudflare runs many isolates and
// invalidateBotProfile only invalidates the one isolate that ran the
// finalize, so warm isolates can hold stale ratings indefinitely. Reading
// fresh costs one Firestore read per bot tier per /run, which is trivial.
// Standard mode picks uniformly at random and ignores ratings, so the
// cache is fine there.

import { BOT_INITIAL_RATING, tierFromBotUid } from './bots';

const DEFAULT_SIGMA = 500;
const DISPLAY_DIVISOR = 2485;
const MAX_MU = 5000;

function muFromDisplay(displayRating) {
  const scaled = (Math.max(0, displayRating) * Math.LN2) / 1000;
  if (scaled === 0) return DEFAULT_SIGMA * 3;
  const conservative = DISPLAY_DIVISOR * Math.log(Math.expm1(scaled));
  return Math.min(MAX_MU, Math.max(0, conservative + 3 * DEFAULT_SIGMA));
}

const cache = new Map();

async function readBotProfile(env, botUid, getDocument) {
  const doc = await getDocument(env, 'players', botUid);
  const data = doc?.data || {};
  const tier = tierFromBotUid(botUid);
  const initialRating = BOT_INITIAL_RATING[tier] ?? 1000;
  return {
    mu: Number(data.mu) || muFromDisplay(initialRating),
    sigma: Number(data.sigma) || DEFAULT_SIGMA,
    rating: Number(data.rating) || initialRating
  };
}

export async function getBotProfile(env, botUid, getDocument, { forceFresh = false } = {}) {
  if (forceFresh) {
    const fresh = await readBotProfile(env, botUid, getDocument);
    cache.set(botUid, fresh);
    return fresh;
  }
  const hit = cache.get(botUid);
  if (hit) return hit;
  const profile = await readBotProfile(env, botUid, getDocument);
  cache.set(botUid, profile);
  return profile;
}

export function invalidateBotProfile(botUid) {
  cache.delete(botUid);
}
