// Weekly Bradley-Terry feature-weight learning. Runs once a week (chained
// before purgeOldGames in the Saturday cron) and re-tunes the placement-phase
// rollout coefficients of `heavyWeight` from outcome-weighted historical play.
//
// We only learn the place-phase weights (ownCoef, oppCoef in the formula
// `1 + ownCoef·ownAdj + oppCoef·oppAdj − 2·deadAdj`). Reasons:
//  - Per-game ingestion only stores placements, not eliminations, so we don't
//    have ground truth for elim-phase decisions.
//  - The deadAdj feature requires the dead bitmap, which isn't reconstructable
//    from placementHistory alone — kept at its hand-tuned −2.
//  - The constant baseline (`1` in the formula) cancels out under softmax and
//    has no gradient, so it stays at 1 too.
// Learned values are persisted in `assimilator/state.policyWeights`. The
// engine reads them via the Assimilator-specific weight closure; if the doc
// is missing or `policyWeightsTrainedOnGames < MIN_TRAINED_GAMES`, the engine
// falls back to the hand-tuned defaults.

import { passesQualityFilter } from './qualityFilter';
import {
  getAssimilatorState,
  getAssimilatorUpdateTime,
  setCachedAssimilatorState,
  ASSIMILATOR_STATE_COLLECTION,
  ASSIMILATOR_STATE_DOC_ID
} from './state';

const PAGE_SIZE = 300;
const MAX_PAGES = 20;                     // 6,000 games max per run.
const BT_ITERATIONS = 50;
const LEARNING_RATE = 0.1;
const MIN_TRAINED_GAMES = 100;            // Engine ignores learned weights below this.
const PRIOR_WEIGHTS = { ownCoef: 3.0, oppCoef: 2.0 };  // The hand-tuned defaults.
const PRIOR_STRENGTH = 50;                // Pseudo-samples anchoring weights to prior — prevents wild swings on small data.

function placementToIdx(p, size) {
  if (!p || !Number.isInteger(p.r) || !Number.isInteger(p.c)) return -1;
  if (p.r < 0 || p.r >= size || p.c < 0 || p.c >= size) return -1;
  return p.r * size + p.c;
}

// 8-neighbor count of `who` around idx in a flat cells array.
function countAdjacent(cells, size, idx, who) {
  const r = (idx / size) | 0;
  const c = idx - r * size;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (cells[nr * size + nc] === who) n++;
    }
  }
  return n;
}

// Mirror of aiEngine.genPlacements but without the dead bitmap (we don't
// have it during historical replay). Returns list of candidate idxs.
function genPlacementsApprox(cells, size) {
  const N2 = size * size;
  const out = [];
  for (let i = 0; i < N2; i++) {
    if (cells[i] !== 0) continue;
    const r = (i / size) | 0;
    const c = i - r * size;
    let hasFreeNeighbor = false;
    for (let dr = -1; dr <= 1 && !hasFreeNeighbor; dr++) {
      for (let dc = -1; dc <= 1 && !hasFreeNeighbor; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        if (cells[nr * size + nc] === 0) hasFreeNeighbor = true;
      }
    }
    if (hasFreeNeighbor) out.push(i);
  }
  return out;
}

// Build per-decision training tuples from a single game. Each tuple:
//   { weight, ownChosen, oppChosen, candidates: [{ ownAdj, oppAdj }] }
// where `weight` ∈ {+1, -1, 0} reflects the mover's outcome.
function buildSamplesFromGame(game) {
  const size = Number(game.gridSize) || 0;
  if (!Number.isInteger(size) || size < 4 || size > 12) return [];
  const N2 = size * size;
  const winner = Number(game.result?.winner);
  if (![0, 1, 2].includes(winner)) return [];
  const ph = game.placementHistory || { p1: [], p2: [] };
  const p1 = Array.isArray(ph.p1) ? ph.p1 : [];
  const p2 = Array.isArray(ph.p2) ? ph.p2 : [];

  const cells = new Int8Array(N2);
  const samples = [];
  const turns = Math.max(p1.length, p2.length);

  function emitSample(side, chosenIdx) {
    const candidates = genPlacementsApprox(cells, size);
    if (!candidates.includes(chosenIdx)) return;          // history desync — bail on this turn.
    if (candidates.length < 2) return;                    // forced move; no learning signal.
    const opp = side === 1 ? 2 : 1;
    const candFeatures = new Array(candidates.length);
    let chosenPos = -1;
    for (let i = 0; i < candidates.length; i++) {
      const idx = candidates[i];
      candFeatures[i] = {
        ownAdj: countAdjacent(cells, size, idx, side),
        oppAdj: countAdjacent(cells, size, idx, opp)
      };
      if (idx === chosenIdx) chosenPos = i;
    }
    if (chosenPos < 0) return;
    let weight;
    if (winner === 0) weight = 0;
    else if (winner === side) weight = 1;
    else weight = -1;
    if (weight === 0) return;                             // draws contribute 0 gradient — drop early.
    samples.push({ weight, candidates: candFeatures, chosenPos });
  }

  for (let t = 0; t < turns; t++) {
    if (t < p1.length) {
      const idx = placementToIdx(p1[t], size);
      if (idx >= 0) {
        emitSample(1, idx);
        cells[idx] = 1;
      }
    }
    if (t < p2.length) {
      const idx = placementToIdx(p2[t], size);
      if (idx >= 0) {
        emitSample(2, idx);
        cells[idx] = 2;
      }
    }
  }
  return samples;
}

// One BT/MM gradient step. Updates `weights` in place; returns the average
// negative-log-likelihood for diagnostic logging. Sample.weight ∈ {-1, +1};
// for losing-side samples we flip the role of "chosen" vs "rejected" by
// negating the gradient contribution — this is equivalent to the Bradley-Terry
// pairwise formulation where the loser is the non-preferred option.
function btIteration(samples, weights) {
  let totalNll = 0;
  const grad = { ownCoef: 0, oppCoef: 0 };
  for (const s of samples) {
    const cands = s.candidates;
    let maxScore = -Infinity;
    const scores = new Array(cands.length);
    for (let i = 0; i < cands.length; i++) {
      const sc = weights.ownCoef * cands[i].ownAdj + weights.oppCoef * cands[i].oppAdj;
      scores[i] = sc;
      if (sc > maxScore) maxScore = sc;
    }
    let Z = 0;
    const probs = new Array(cands.length);
    for (let i = 0; i < cands.length; i++) {
      probs[i] = Math.exp(scores[i] - maxScore);
      Z += probs[i];
    }
    for (let i = 0; i < cands.length; i++) probs[i] /= Z;

    const chosen = cands[s.chosenPos];
    const sign = s.weight;       // +1 = winning move (push toward), -1 = losing move (push away)
    let expOwn = 0, expOpp = 0;
    for (let i = 0; i < cands.length; i++) {
      expOwn += probs[i] * cands[i].ownAdj;
      expOpp += probs[i] * cands[i].oppAdj;
    }
    grad.ownCoef += sign * (expOwn - chosen.ownAdj);
    grad.oppCoef += sign * (expOpp - chosen.oppAdj);
    totalNll += -Math.log(Math.max(1e-12, probs[s.chosenPos])) * sign;
  }

  // L2 prior pull toward the hand-tuned defaults (PRIOR_STRENGTH pseudo-samples).
  grad.ownCoef += PRIOR_STRENGTH * (weights.ownCoef - PRIOR_WEIGHTS.ownCoef);
  grad.oppCoef += PRIOR_STRENGTH * (weights.oppCoef - PRIOR_WEIGHTS.oppCoef);

  const denom = Math.max(1, samples.length + PRIOR_STRENGTH);
  weights.ownCoef -= LEARNING_RATE * grad.ownCoef / denom;
  weights.oppCoef -= LEARNING_RATE * grad.oppCoef / denom;
  // Clamp to a sane range so a runaway gradient can't push the coefficients
  // to absurd values that the rollout policy then propagates.
  weights.ownCoef = Math.max(-2, Math.min(10, weights.ownCoef));
  weights.oppCoef = Math.max(-2, Math.min(10, weights.oppCoef));
  return totalNll / Math.max(1, samples.length);
}

async function streamFinishedGames(env, helpers, onGame) {
  const { firestoreFetch } = helpers;
  let totalSeen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let response;
    try {
      response = await firestoreFetch(env, ':runQuery', {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'games' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'EQUAL',
                value: { stringValue: 'finished' }
              }
            },
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE
          }
        })
      });
    } catch (err) {
      console.error('[assimilator-learn] runQuery threw', err?.message);
      return totalSeen;
    }
    if (!response.ok) {
      const txt = await response.text();
      console.error(`[assimilator-learn] runQuery ${response.status}: ${txt}`);
      return totalSeen;
    }
    const rows = await response.json();
    const docs = rows.map((r) => r.document).filter(Boolean);
    if (docs.length === 0) break;
    for (const d of docs) {
      const data = helpers.firestoreObjectFromFields(d.fields || {});
      onGame(data);
      totalSeen++;
    }
    if (docs.length < PAGE_SIZE) break;
  }
  return totalSeen;
}

// Public entry point. Called from the Saturday cron BEFORE purgeOldGames.
// Best-effort and idempotent: if it fails, the existing learned weights stay
// in place. Returns a small summary object for cron logs.
export async function runFeatureWeightLearning(env, helpers) {
  const { getDocument, writeDocument } = helpers;
  let totalGames = 0;
  let qualifyingGames = 0;
  const samples = [];

  await streamFinishedGames(env, helpers, (game) => {
    totalGames++;
    if (!passesQualityFilter(game)) return;
    qualifyingGames++;
    const sampleList = buildSamplesFromGame(game);
    for (const s of sampleList) samples.push(s);
  });

  if (samples.length === 0) {
    console.log(`[assimilator-learn] no qualifying samples (saw ${totalGames} games) — skipping update`);
    return { totalGames, qualifyingGames, samples: 0, updated: false };
  }

  let state;
  try {
    state = await getAssimilatorState(env, getDocument, { forceFresh: true });
  } catch (err) {
    console.warn('[assimilator-learn] state read failed', err?.message);
    return { totalGames, qualifyingGames, samples: samples.length, updated: false };
  }

  const weights = state.policyWeights && Number.isFinite(Number(state.policyWeights.ownCoef))
    ? { ownCoef: Number(state.policyWeights.ownCoef), oppCoef: Number(state.policyWeights.oppCoef) }
    : { ...PRIOR_WEIGHTS };

  let lastNll = NaN;
  for (let iter = 0; iter < BT_ITERATIONS; iter++) {
    lastNll = btIteration(samples, weights);
  }

  const nextState = {
    ...state,
    policyWeights: {
      ownCoef: weights.ownCoef,
      oppCoef: weights.oppCoef,
      // The eliminate-phase weights stay hand-tuned — surfaced here so the
      // Firestore doc shape is self-describing and a future learner can fill
      // them in without a schema change.
      eliminateOppCoef: 4.0,
      eliminateOwnCoef: -2.0
    },
    policyWeightsTrainedOnGames: qualifyingGames,
    policyWeightsUpdatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const updateTime = getAssimilatorUpdateTime();
  try {
    const written = await writeDocument(
      env,
      ASSIMILATOR_STATE_COLLECTION,
      ASSIMILATOR_STATE_DOC_ID,
      nextState,
      updateTime || undefined
    );
    setCachedAssimilatorState(nextState, written?.updateTime || null);
  } catch (err) {
    console.warn('[assimilator-learn] state write failed', err?.message);
    return {
      totalGames,
      qualifyingGames,
      samples: samples.length,
      updated: false,
      ownCoef: weights.ownCoef,
      oppCoef: weights.oppCoef
    };
  }

  console.log(
    `[assimilator-learn] updated weights: ownCoef=${weights.ownCoef.toFixed(3)} oppCoef=${weights.oppCoef.toFixed(3)} ` +
    `(samples=${samples.length} qualifyingGames=${qualifyingGames}/${totalGames} nll=${lastNll.toFixed(4)})`
  );

  return {
    totalGames,
    qualifyingGames,
    samples: samples.length,
    updated: true,
    ownCoef: weights.ownCoef,
    oppCoef: weights.oppCoef
  };
}

export const ASSIMILATOR_LEARN_MIN_TRAINED_GAMES = MIN_TRAINED_GAMES;
export const ASSIMILATOR_LEARN_PRIOR_WEIGHTS = PRIOR_WEIGHTS;
