// Difficulty tier configuration shared between the main thread (UI / engine
// wrapper) and the search worker. Pure constants — no React, no DOM.

// Two parallel ladders share this file:
//   1) Alpha-beta ladder (offline + online):
//      connector    — kind:'oneply'  + simple eval        (Beginner)
//      concentrator — kind:'oneply'  + basic eval         (Novice; same 1-ply
//                     greedy as connector but uses material+liberty+neutral
//                     eval instead of just biggest-group diff)
//      constructor  — kind:'fixedab' + basic eval, d=3    (Intermediate)
//      coordinator  — kind:'idab'    + basic eval, 12s budget
//                     (Advanced; plain iterative deepening with TT + smart
//                     time-stop. No endgame-solver handoff. Quiescence/PVS/
//                     aspiration were measured to regress strength in this
//                     game's branching pattern and are OFF by default — see
//                     runIDAB doc in aiEngineCore.)
//   2) MCTS-RAVE personality ladder (tuned mctsC=0.5, raveK=3000):
//      confiscator  — attackHeavy:  aggressive, contests opponent territory
//      conservator  — defenseHeavy: builds own group, avoids opponent contact
//      cumulator    — collectHeavy: own-group focused, neutral on opponent contact
//      collector    — heavy:        balanced offense + defense (default tier)
//      curator      — heavy + opening book + MAST prior + learned policy weights
//                     (online-only; aiEngine reads cfg.curatorState injected
//                     by the worker. Offline play has no state doc → falls back
//                     to default heavy and behaves identically to `collector`.)
// `personalityEndgame: true` opts a tier into the personality-aware endgame
// solver: positive margins are clamped to +1 (a win is a win; no over-attacking
// for extra margin) and the personality weight breaks ties among equally
// winning lines. Collector, Curator, and Coordinator stay on the original
// margin eval — strongest tiers don't need the tiebreak to express character.
export const AI_TIERS = {
  connector:   { kind: 'oneply',   evalName: 'simple' },
  concentrator:{ kind: 'oneply',   evalName: 'basic' },
  constructor: { kind: 'fixedab',  evalName: 'basic', depth: 3 },
  coordinator: { kind: 'idab',     evalName: 'basic', timeMs: 12000, endgame: false },
  confiscator: { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'attackHeavy',  endgame: true, endgameDepth: 12, reuseTree: true, rolloutShortcut: false, personalityEndgame: true,  mctsC: 0.5, raveK: 3000 },
  conservator: { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'defenseHeavy', endgame: true, endgameDepth: 12, reuseTree: true, rolloutShortcut: false, personalityEndgame: true,  mctsC: 0.5, raveK: 3000 },
  cumulator:   { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'collectHeavy', endgame: true, endgameDepth: 12, reuseTree: true, rolloutShortcut: false, personalityEndgame: true,  mctsC: 0.5, raveK: 3000 },
  collector:   { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'heavy',        endgame: true, endgameDepth: 12, reuseTree: true, rolloutShortcut: false, personalityEndgame: false, mctsC: 0.5, raveK: 3000 },
  curator:     { kind: 'mctsrave', simBudget: 25000, timeMs: 12000, policy: 'heavy',        endgame: true, reuseTree: true, rolloutShortcut: false }
};

export const TIER_ORDER = ['connector', 'concentrator', 'constructor', 'coordinator', 'confiscator', 'conservator', 'cumulator', 'collector', 'curator'];

// Endgame solver (Advanced only) — exact αβ to terminal, no eval
export const ENDGAME_THRESHOLD = 12;
export const ENDGAME_SAFETY_MS = 2000;

// Skip the endgame solver entirely on boards smaller than this. 4×4 and 6×6
// play the whole game in their main search (MCTS-RAVE or IDAB) — the αβ
// handoff is overkill at those scales, and 6×6 endgames converge fast enough
// in the main search that the dedicated solver doesn't add measurable strength.
// 7×7 and up use the endgame solver — the exact αβ converges in well under
// ENDGAME_SAFETY_MS once countEmpty() ≤ ENDGAME_THRESHOLD.
export const MIN_ENDGAME_BOARD_SIZE = 7;

// Cap each tier's per-move time budget (cfg.timeMs) at this value on boards
// strictly smaller than SMALL_BOARD_TIME_CAP_SIZE. 6×6 plays without the
// endgame solver (handled by the main search) and keeps the 6 s cap, since
// MCTS-RAVE / IDAB still converge quickly there and the full 12 s budget
// adds wall-clock without improving move quality.
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
