// Cross-game MAST (Move-Average Sampling Technique) for the Assimilator tier.
// Distinct from the per-search AMAF/RAVE tables in aiEngine.js — those reset
// every chooseAIMove call and live entirely in the search; the MAST here is
// state-independent and accumulates across thousands of finished games.
//
// Schema (in `assimilator/state.mast[size]`):
//   key: `${side}_${phase}_${moveIdx}`  — e.g. "1_0_27" = P1's place at idx 27
//   val: { sum: <Float>, n: <Int> }     — sum of signed outcomes, sample count
//
// Outcome convention: +1 if the side that played this move went on to win the
// game, −1 if they lost, 0 for a draw. mean = sum/n is therefore in [-1, +1]
// and can be used directly as a UCT prior or as a rollout-policy multiplier.
//
// Right now we only ingest place-phase moves (phase = 0) — the eliminate phase
// has too small an action space to benefit from a global table, and the
// historical replay can't unambiguously reconstruct eliminate moves from
// placementHistory alone. The phase parameter is kept in the schema for
// future extension.

const PLACE = 0;
const ELIMINATE = 1;
const N_CAP = 5000;
const PRIOR_BLEND_LAMBDA = 0.5;   // policyWeight × (1 + λ · mastMean) in pickWeighted blend.

export function mastKey(side, phase, moveIdx) {
  return `${side}_${phase}_${moveIdx}`;
}

// Returns { mean, n }. Missing entry → { mean: 0, n: 0 } so the caller can
// detect "no data" via n === 0 and skip the blend.
export function mastPrior(mastForSize, side, phase, moveIdx) {
  if (!mastForSize) return { mean: 0, n: 0 };
  const e = mastForSize[mastKey(side, phase, moveIdx)];
  if (!e) return { mean: 0, n: 0 };
  const n = Number(e.n) || 0;
  if (n === 0) return { mean: 0, n: 0 };
  const sum = Number(e.sum) || 0;
  return { mean: sum / n, n };
}

// Helper used by the aiEngine MAST blend: returns a multiplier ≥ 0 (typically
// in [0.5, 1.5]) so existing policy weights stay positive. When n is small,
// the multiplier collapses toward 1 (the prior contributes nothing). When n
// is large, the prior fully shapes the multiplier.
export function mastMultiplier(mastForSize, side, phase, moveIdx) {
  const { mean, n } = mastPrior(mastForSize, side, phase, moveIdx);
  if (n === 0) return 1;
  const confidence = Math.min(1, n / 100);   // ramp up over the first 100 samples
  return Math.max(0.05, 1 + PRIOR_BLEND_LAMBDA * mean * confidence);
}

// Mutates `mastForSize` in place. `samples` is an array of
// { side, phase, move, outcome } where outcome ∈ {'win','loss','draw'} from
// the mover's perspective.
export function recordMastSamples(mastForSize, samples) {
  if (!Array.isArray(samples)) return;
  for (const s of samples) {
    if (!s || !Number.isInteger(s.move)) continue;
    const k = mastKey(s.side, s.phase, s.move);
    const signed = s.outcome === 'win' ? 1 : s.outcome === 'loss' ? -1 : 0;
    let e = mastForSize[k];
    if (!e) {
      e = { sum: 0, n: 0 };
      mastForSize[k] = e;
    }
    e.sum = (Number(e.sum) || 0) + signed;
    e.n = (Number(e.n) || 0) + 1;
    if (e.n > N_CAP) {
      // Halve both sum and n so recent samples weigh more — same overflow
      // trick aiEngine.bumpHistory uses for the killer/history table.
      e.sum *= 0.5;
      e.n = Math.floor(e.n * 0.5);
    }
  }
}

export const MAST_CAP_PER_ENTRY = N_CAP;
export const MAST_PRIOR_LAMBDA = PRIOR_BLEND_LAMBDA;
export const MAST_PHASE_PLACE = PLACE;
export const MAST_PHASE_ELIMINATE = ELIMINATE;
