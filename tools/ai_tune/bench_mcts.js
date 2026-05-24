#!/usr/bin/env node
// Bench: how many MCTS-RAVE sims actually fit in cfg.timeMs?
//
// Uses the same esbuild-bundle approach as engine_bridge.js so we exercise
// the live engine code path. Runs one chooseAIMove call per (size, policy)
// pair on an empty starting position with `simBudget: 1_000_000_000` — sims
// are effectively uncapped, so time runs out first. The engine itself logs
// `[aiEngine] runMCTSRave done: sims=N ...` which we let through (no console
// silencing here).
//
// Usage:
//   node bench_mcts.js                # default: sizes 6,8,10  policies heavy
//   node bench_mcts.js 8 heavy 12000  # one (size, policy, timeMs) run
//
// Note: the engine applies SMALL_BOARD_TIME_CAP_SIZE=8 → boards <8 cap at
// SMALL_BOARD_MAX_TIME_MS=6000ms regardless of requested timeMs.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '_entry.js');

const bundle = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  write: false,
});
const code = bundle.outputFiles[0].text;
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const { chooseAIMove, AI_TIERS } = await import(dataUrl);

function emptyState(size) {
  const state = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push({ player: 0, eliminated: false });
    state.push(row);
  }
  return state;
}

async function benchOne(size, policy, timeMs) {
  const tierKey = '__bench__';
  AI_TIERS[tierKey] = {
    kind: 'mctsrave',
    simBudget: 1_000_000_000,
    timeMs,
    policy,
    endgame: false,
    reuseTree: false,
    rolloutShortcut: false
  };
  process.stdout.write(`\n=== size ${size}x${size}  policy=${policy}  requested timeMs=${timeMs} ===\n`);
  const t0 = Date.now();
  const move = await chooseAIMove({
    tier: tierKey,
    state: emptyState(size),
    size,
    phase: 'place',
    lastPlaces: null,
    currentPlayer: 1
  });
  const wall = Date.now() - t0;
  process.stdout.write(`# bench wall=${wall}ms  move=${JSON.stringify(move)}\n`);
}

const args = process.argv.slice(2);
if (args.length >= 2) {
  // Single-run mode: <size> <policy> [timeMs]
  await benchOne(Number(args[0]), args[1], Number(args[2] || 12000));
} else {
  // Default sweep
  const sizes    = [6, 8, 10];
  const policies = ['heavy'];
  const timeMs   = 12000;
  for (const sz of sizes) {
    for (const p of policies) {
      await benchOne(sz, p, timeMs);
    }
  }
}
