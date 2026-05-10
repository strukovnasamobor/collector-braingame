// Per-isolate cache of the single `curator/state` Firestore doc. Holds the
// learned policy weights, the cross-game MAST table, and the opening book —
// every Curator turn reads from this exact same shared state.
//
// One Firestore read per cold isolate; subsequent calls are O(1) memory hits.
// Pass { forceFresh: true } from write paths after committing updates so the
// next reader in the same isolate sees the new values immediately. Other
// warm isolates discover the change on their next cold read or via explicit
// invalidate (we don't broadcast across isolates — staleness is bounded by
// isolate lifetime, which is minutes-to-hours on Cloudflare Workers).

const STATE_COLLECTION = 'curator';
const STATE_DOC_ID = 'state';

// Empty defaults. `policyWeights: null` is the signal to aiEngine that no
// learned weights are available yet → fall back to hand-tuned constants.
function defaultState() {
  return {
    policyWeights: null,
    policyWeightsTrainedOnGames: 0,
    policyWeightsUpdatedAt: null,
    mast: {},
    book: {},
    botRatingsResetAt: null,
    updatedAt: null
  };
}

let cached = null;
let cachedUpdateTime = null;

async function readFromFirestore(env, getDocument) {
  const doc = await getDocument(env, STATE_COLLECTION, STATE_DOC_ID);
  if (!doc) {
    return { state: defaultState(), updateTime: null };
  }
  // Spread over defaults so partial docs (early life-cycle, or after a manual
  // partial write) still produce a complete shape downstream.
  const merged = { ...defaultState(), ...(doc.data || {}) };
  return { state: merged, updateTime: doc.updateTime || null };
}

export async function getCuratorState(env, getDocument, { forceFresh = false } = {}) {
  if (forceFresh || !cached) {
    const { state, updateTime } = await readFromFirestore(env, getDocument);
    cached = state;
    cachedUpdateTime = updateTime;
  }
  return cached;
}

export function getCuratorUpdateTime() {
  return cachedUpdateTime;
}

// Replace the cached state in-place after a successful write. `newUpdateTime`
// is the updateTime returned by the Firestore PATCH so subsequent precondition
// writes from this isolate use the right token.
export function setCachedCuratorState(state, newUpdateTime) {
  cached = state;
  cachedUpdateTime = newUpdateTime || null;
}

export function invalidateCuratorState() {
  cached = null;
  cachedUpdateTime = null;
}

export const CURATOR_STATE_COLLECTION = STATE_COLLECTION;
export const CURATOR_STATE_DOC_ID = STATE_DOC_ID;
