// Difficulty tier configuration shared between the main thread (UI / engine
// wrapper) and the search worker. Pure constants — no React, no DOM.

export const AI_TIERS = {
  beginner: { kind: 'oneply' },
  easy:     { kind: 'idab', budgetMs:  200, eps: 0.15, epsMin: 2.0,  endgame: false },
  medium:   { kind: 'idab', budgetMs: 1000, eps: 0.05, epsMin: 1.0,  endgame: false },
  hard:     { kind: 'idab', budgetMs: 3000, eps: 0.01, epsMin: 0.5,  endgame: false },
  expert:   { kind: 'idab', budgetMs: 6000, eps: 0,    epsMin: 0,    endgame: true  }
};

export const TIER_ORDER = ['beginner', 'easy', 'medium', 'hard', 'expert'];

export const ENDGAME_THRESHOLD = 8;       // remaining empty non-elim cells
export const ENDGAME_SAFETY_MS = 1000;    // fall back to IDAB if solver overruns
export const EVAL_MATERIAL = 10.0;        // weight on biggest-group diff (the actual scoring rule)
export const EVAL_EXT      = 0.5;         // weight on biggest-group frontier (growth potential)
export const EVAL_TOTAL    = 0.3;         // weight on total dot-count (tertiary nudge to lay claim)
export const WIN_MAG       = 100000;      // terminal magnitude
