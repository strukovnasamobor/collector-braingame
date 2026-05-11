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
// `personalityEndgame: true` opts a tier into the personality-aware endgame
// solver: positive margins are clamped to +1 (a win is a win; no over-attacking
// for extra margin) and the personality weight breaks ties among equally
// winning lines. Collector and Curator stay on the original margin eval — they
// are the strongest tiers and don't need the tiebreak to express character.
export const AI_TIERS = {
  confiscator: { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'attackHeavy',  endgame: true, reuseTree: true, rolloutShortcut: false, personalityEndgame: true },
  conservator: { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'defenseHeavy', endgame: true, reuseTree: true, rolloutShortcut: false, personalityEndgame: true },
  cumulator:   { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'collectHeavy', endgame: true, reuseTree: true, rolloutShortcut: false, personalityEndgame: true },
  collector:   { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'heavy',        endgame: true, reuseTree: true, rolloutShortcut: false },
  curator:     { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'heavy',        endgame: true, reuseTree: true, rolloutShortcut: false }
};

export const TIER_ORDER = ['confiscator', 'conservator', 'cumulator', 'collector', 'curator'];

// Endgame solver (Advanced only) — exact αβ to terminal, no eval
export const ENDGAME_THRESHOLD = 12;
export const ENDGAME_SAFETY_MS = 2000;

// Skip the endgame solver entirely on boards smaller than this. 4×4 still
// plays the whole game in MCTS-RAVE (the αβ handoff is overkill at that scale).
// 6×6 and up use the endgame solver — the exact αβ converges in well under
// ENDGAME_SAFETY_MS once countEmpty() ≤ ENDGAME_THRESHOLD.
export const MIN_ENDGAME_BOARD_SIZE = 6;

// Cap each tier's per-move time budget (cfg.timeMs) at this value on boards
// strictly smaller than SMALL_BOARD_TIME_CAP_SIZE. Decoupled from
// MIN_ENDGAME_BOARD_SIZE: 6×6 now uses the endgame solver AND keeps the
// 6 s cap, since MCTS-RAVE still converges quickly there and the full 12 s
// budget adds wall-clock without improving move quality.
export const SMALL_BOARD_TIME_CAP_SIZE = 8;
export const SMALL_BOARD_MAX_TIME_MS   = 6000;

// Eval — basic (Novice)
export const EVAL_BASIC_MATERIAL    = 10.0;
export const EVAL_BASIC_LIBERTY     = 0.4;
export const EVAL_BASIC_NEUTRAL_PEN = 0.5;

// MCTS (Conquistador)
export const MCTS_C    = 0.5;         // UCT exploration constant — tuned via 50-game self-play A/B (was sqrt(2))
export const RAVE_K    = 3000;        // β = √(K / (3·N + K)) — tuned via raveK sweep (was 1500)
export const PW_ALPHA  = 0.5;         // progressive widening: max children = ceil(visits^α)

export const WIN_MAG = 100000;
