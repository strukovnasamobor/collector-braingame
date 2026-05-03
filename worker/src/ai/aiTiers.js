// Difficulty tier configuration shared between the main thread (UI / engine
// wrapper) and the search worker. Pure constants — no React, no DOM.

export const AI_TIERS = {
  seeker:    { kind: 'oneply',   evalName: 'simple' },
  hunter:    { kind: 'fixedab',  depth: 3, evalName: 'basic', timeMs: 2000 },
  collector: { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'heavy', endgame: true, reuseTree: true, rolloutShortcut: false }
};

export const TIER_ORDER = ['seeker', 'hunter', 'collector'];

// Endgame solver (Advanced only) — exact αβ to terminal, no eval
export const ENDGAME_THRESHOLD = 12;
export const ENDGAME_SAFETY_MS = 2000;

// Eval — basic (Novice)
export const EVAL_BASIC_MATERIAL    = 10.0;
export const EVAL_BASIC_LIBERTY     = 0.4;
export const EVAL_BASIC_NEUTRAL_PEN = 0.5;

// MCTS (Conquistador)
export const MCTS_C    = 0.5;         // UCT exploration constant — tuned via 50-game self-play A/B (was sqrt(2))
export const RAVE_K    = 3000;        // β = √(K / (3·N + K)) — tuned via raveK sweep (was 1500)
export const PW_ALPHA  = 0.5;         // progressive widening: max children = ceil(visits^α)

export const WIN_MAG = 100000;
