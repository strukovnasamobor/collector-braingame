// Shared quality gate for Curator training data. Used by both per-game
// ingestion (finalizeMatchCleanup → recordBookEntry / recordMastSamples) and
// the weekly Bradley-Terry weight learner. Single source of truth: when these
// thresholds change, both paths follow.
//
// Note on the "higher-rated player ≥ 1200" criterion from the original plan:
// the games/ doc does not snapshot player ratings at game start, so applying
// it here would require a per-ingestion player profile read (2 extra Firestore
// reads per game finish on every isolate). The remaining criteria — finished
// status, winning margin ≥ 3, ≥8 placements, mode standard/ranked — already
// remove low-quality samples (abandonments, coin-flips, private rooms) without
// the extra subrequest cost. Revisit if the learned weights show drift.

const MIN_WINNING_MARGIN = 3;
const MIN_PLACEMENTS_TOTAL = 8;
const ALLOWED_MODES = new Set(['standard', 'ranked']);

// Returns null if the game qualifies, otherwise a short reason string for logging.
export function qualityFilterRejection(game) {
  if (!game) return 'no-game';
  if (game.status !== 'finished') return `status=${game.status}`;
  const result = game.result;
  if (!result || typeof result.winner !== 'number') return 'no-result';
  // Forfeits (timeout / leave) lose all signal value: the losing side either
  // didn't play, or stopped engaging. The reverted-state result still has
  // group sizes from the live position at the time of forfeit, but those
  // weren't shaped by full strategic play.
  if (result.timeout) return 'timeout-forfeit';
  if (game.leftBy) return 'leave-forfeit';

  const score1 = Number(result.score1) || 0;
  const score2 = Number(result.score2) || 0;
  if (Math.abs(score1 - score2) < MIN_WINNING_MARGIN) return `margin<${MIN_WINNING_MARGIN}`;

  const mode = String(game.mode || '');
  if (!ALLOWED_MODES.has(mode)) return `mode=${mode}`;

  const ph = game.placementHistory || { p1: [], p2: [] };
  const total = (Array.isArray(ph.p1) ? ph.p1.length : 0) + (Array.isArray(ph.p2) ? ph.p2.length : 0);
  if (total < MIN_PLACEMENTS_TOTAL) return `placements<${MIN_PLACEMENTS_TOTAL}`;

  return null;
}

export function passesQualityFilter(game) {
  return qualityFilterRejection(game) === null;
}

// Re-exported for tests / log lines that want the threshold value.
export const QUALITY_THRESHOLDS = Object.freeze({
  minWinningMargin: MIN_WINNING_MARGIN,
  minPlacementsTotal: MIN_PLACEMENTS_TOTAL,
  allowedModes: Array.from(ALLOWED_MODES)
});
