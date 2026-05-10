// Opening book for the Assimilator tier. Maps a state-hash → best placement
// move, plus per-entry win/loss/draw counters. Persisted in
// assimilator/state.book[size]; consulted only during the place phase and
// only while total placements played so far is below MAX_PLACEMENTS.
//
// Key design: the book key is FNV-1a over (size, side, cells[]) — the
// `dead[]` bitmap is intentionally omitted. The book is for early-game (≤12
// placements) where elimination state is mostly forced or near-symmetric;
// dropping it removes the ambiguity of replaying historical games where
// individual eliminations aren't recorded (only the end-of-game `dead`
// snapshot is). Two early positions that differ only in eliminate target
// thus collide in the book, which is acceptable: they're effectively the
// same strategic decision.
//
// Lookup gate (anti-flake): a stored move is only served when
//   wins ≥ 2 * losses + 1
// so a single popular-but-bad opening can't poison play. Eviction policy on
// overflow: lowest visits×1000 + (wins − losses) — biased toward dropping
// rarely-touched entries before well-established but losing ones (those
// disappear naturally as they accumulate losses).

const MAX_PLACEMENTS = 12;
// 2000 × 4 sizes × ~60 bytes/entry ≈ 480 KB — well under Firestore's 1 MB
// per-document hard cap. The MCTS search itself only consults the book at
// most once per turn, so even if every entry collided into a single key the
// hot-path cost is unchanged.
const MAX_ENTRIES_PER_SIZE = 2000;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME  = 0x01000193;

function fnv1aHash(bytes) {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// `cells` is any array-like with cells[i] ∈ {0, 1, 2}; for the engine that's
// an Int8Array, for replay it's a freshly built one. `side` ∈ {1, 2} is the
// side about to move. Returns 8 hex chars.
export function buildBookKey(size, side, cells) {
  const N2 = size * size;
  const blob = new Uint8Array(2 + N2);
  blob[0] = size;
  blob[1] = side;
  for (let i = 0; i < N2; i++) blob[2 + i] = cells[i] | 0;
  return fnv1aHash(blob);
}

// Returns the recommended moveIdx, or null if the position is past the book
// horizon, has no entry, has an entry that fails the trust gate, or `book` is
// missing entirely. `currentPlacementCount` = total placements made so far
// (both sides) BEFORE the move we're about to play; pass NaN to skip the
// horizon check.
export function lookupBook(bookForSize, key, currentPlacementCount) {
  if (!bookForSize) return null;
  if (Number.isFinite(currentPlacementCount) && currentPlacementCount >= MAX_PLACEMENTS) return null;
  const entry = bookForSize[key];
  if (!entry || !Number.isInteger(entry.move)) return null;
  const wins = Number(entry.wins) || 0;
  const losses = Number(entry.losses) || 0;
  if (wins < 2 * losses + 1) return null;
  return entry.move;
}

// Mutates `bookForSize` in place. Outcome ∈ {'win','loss','draw'} is from the
// perspective of the side that played `moveIdx` at this position. Caller is
// responsible for ensuring the game passed the quality filter and we are
// within MAX_PLACEMENTS plies.
export function recordBookSample(bookForSize, key, moveIdx, outcome) {
  let entry = bookForSize[key];
  if (!entry) {
    if (Object.keys(bookForSize).length >= MAX_ENTRIES_PER_SIZE) {
      const evictKey = pickEvictionKey(bookForSize);
      if (evictKey) delete bookForSize[evictKey];
    }
    entry = { move: moveIdx, wins: 0, losses: 0, draws: 0 };
    bookForSize[key] = entry;
  } else if (entry.move !== moveIdx) {
    // Schema stores one move per key. If the new sample disagrees, only
    // overwrite when the existing move has a net-negative record — otherwise
    // keep the established move and credit/debit it with this outcome anyway,
    // so a genuinely worse cached move erodes and eventually flips on its
    // own.
    const net = (Number(entry.wins) || 0) - (Number(entry.losses) || 0);
    if (net < 0) {
      entry.move = moveIdx;
      entry.wins = 0;
      entry.losses = 0;
      entry.draws = 0;
    }
  }
  if (outcome === 'win') entry.wins = (Number(entry.wins) || 0) + 1;
  else if (outcome === 'loss') entry.losses = (Number(entry.losses) || 0) + 1;
  else entry.draws = (Number(entry.draws) || 0) + 1;
}

function pickEvictionKey(bookForSize) {
  let worstKey = null;
  let worstScore = Infinity;
  for (const k in bookForSize) {
    const e = bookForSize[k];
    const visits = (Number(e.wins) || 0) + (Number(e.losses) || 0) + (Number(e.draws) || 0);
    const net = (Number(e.wins) || 0) - (Number(e.losses) || 0);
    const score = visits * 1000 + net;
    if (score < worstScore) {
      worstScore = score;
      worstKey = k;
    }
  }
  return worstKey;
}

export const OPENING_BOOK_MAX_PLACEMENTS = MAX_PLACEMENTS;
export const OPENING_BOOK_MAX_ENTRIES_PER_SIZE = MAX_ENTRIES_PER_SIZE;
