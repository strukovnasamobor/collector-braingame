// Difficulty tier configuration shared between the main thread (UI / engine
// wrapper) and the search worker. Pure constants — no React, no DOM.

// All five tiers run MCTS-RAVE with the tuned constants (mctsC=0.5,
// raveK=3000); the personality differentiator is the rollout/expansion policy.
//   confiscator  — attackHeavy:  aggressive, contests opponent territory
//   conservator  — defenseHeavy: builds own group, avoids opponent contact
//   cumulator    — collectHeavy: own-group focused, neutral on opponent contact
//   collector    — heavy:        balanced offense + defense
//   curator      — heavy + opening book + MAST prior + learned policy weights
//                  (online-only; aiEngine reads cfg.curatorState injected
//                  by the worker. Offline play has no state doc → falls back
//                  to default heavy and behaves identically to `collector`.)
export const AI_TIERS = {
  confiscator: { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'attackHeavy',  endgame: true, reuseTree: true, rolloutShortcut: false },
  conservator: { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'defenseHeavy', endgame: true, reuseTree: true, rolloutShortcut: false },
  cumulator:   { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'collectHeavy', endgame: true, reuseTree: true, rolloutShortcut: false },
  collector:   { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'heavy',        endgame: true, reuseTree: true, rolloutShortcut: false },
  curator:     { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'heavy',        endgame: true, reuseTree: true, rolloutShortcut: false }
};

export const TIER_ORDER = ['confiscator', 'conservator', 'cumulator', 'collector', 'curator'];

// Endgame solver (Advanced only) — exact αβ to terminal, no eval
export const ENDGAME_THRESHOLD = 12;
export const ENDGAME_SAFETY_MS = 2000;

// Skip the endgame solver entirely on boards smaller than this. The αβ-to-
// terminal handoff is too aggressive on tiny boards — MCTS-RAVE plays the
// whole game on 4×4 and 6×6.
export const MIN_ENDGAME_BOARD_SIZE = 8;

// Cap each tier's per-move time budget (cfg.timeMs) at this value when the
// board is below MIN_ENDGAME_BOARD_SIZE. The full 12 s budget is overkill on
// 4×4 / 6×6 — MCTS-RAVE converges quickly there, and the extra wall-clock
// only adds latency without improving move quality. Larger boards keep
// whatever cfg.timeMs the tier configured.
export const SMALL_BOARD_MAX_TIME_MS = 6000;

// Eval — basic (Novice)
export const EVAL_BASIC_MATERIAL    = 10.0;
export const EVAL_BASIC_LIBERTY     = 0.4;
export const EVAL_BASIC_NEUTRAL_PEN = 0.5;

// MCTS (Conquistador)
export const MCTS_C    = 0.5;         // UCT exploration constant — tuned via 50-game self-play A/B (was sqrt(2))
export const RAVE_K    = 3000;        // β = √(K / (3·N + K)) — tuned via raveK sweep (was 1500)
export const PW_ALPHA  = 0.5;         // progressive widening: max children = ceil(visits^α)

export const WIN_MAG = 100000;
