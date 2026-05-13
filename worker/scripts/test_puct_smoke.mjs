// Run from repo root: node worker/scripts/test_puct_smoke.mjs
// End-to-end smoke test for the JS PUCT MCTS:
//   - Loads ONNX model
//   - Runs a 200-sim search from initial state
//   - Plays one full self-play game

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AzNet } from '../src/ai/azNet.js';
import { puctSearch, rootVisitDistribution, pickMove } from '../src/ai/azMcts.js';
import { initialState, applyMove, hasLegalMove, computeWinner } from '../src/ai/azGame.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = resolve(__dirname, '../models/az_iter0_8x8.onnx');

console.log(`Loading model: ${MODEL_PATH}`);
const net = await AzNet.loadFromFile(MODEL_PATH);
console.log('Loaded.\n');

// ─── Test 1: single search from initial state ───────────────────────────
console.log('Test 1: PUCT 200 sims from initial 8×8 state');
const state = initialState(8);
const t0 = Date.now();
const root = await puctSearch(state, 200, net, { batchSize: 16 });
const dt = (Date.now() - t0) / 1000;
console.log(`  time:  ${dt.toFixed(2)}s  (${(200 / dt).toFixed(0)} sims/sec)`);
console.log(`  root.visits: ${root.visits}`);
console.log(`  children:    ${root.children.length}`);
console.log('  top 5 by visits:');
const sorted = [...root.children].sort((a, b) => b.visits - a.visits);
for (const c of sorted.slice(0, 5)) {
  const r = Math.floor(c.move / 8), col = c.move % 8;
  const q = c.visits > 0 ? c.totalScore / c.visits : 0;
  console.log(`    move ${String(c.move).padStart(2)} (${r},${col})  `
            + `visits=${String(c.visits).padStart(3)}  `
            + `prior=${c.prior.toFixed(3)}  `
            + `Q=${q.toFixed(3)}`);
}

// ─── Test 2: visit distribution shape ───────────────────────────────────
const { pi, total } = rootVisitDistribution(root, 64);
const piNonzero = pi.filter(x => x > 0).length;
const piMax = Math.max(...pi);
const piSum = pi.reduce((a, b) => a + b, 0);
const visitedChildren = root.children.filter(c => c.visits > 0).length;
console.log('\nTest 2: visit distribution');
console.log(`  total visits in children: ${total}`);
console.log(`  visited children:         ${visitedChildren} of ${root.children.length}  `
          + `(PUCT focuses; not all visited at low sim count)`);
console.log(`  nonzero pi entries:       ${piNonzero}  (expected ${visitedChildren})`);
console.log(`  max prob:                 ${piMax.toFixed(3)}`);
console.log(`  sum:                      ${piSum.toFixed(3)}  (expected 1.000)`);

const ok2 = piNonzero === visitedChildren && Math.abs(piSum - 1.0) < 1e-5;
console.log(`  ${ok2 ? '✓ OK' : '✗ FAIL'}`);

// ─── Test 3: one full self-play game ────────────────────────────────────
console.log('\nTest 3: one full self-play game (sim=100 per move, greedy)');
const gs = initialState(8);
let plies = 0;
const t1 = Date.now();
while (hasLegalMove(gs)) {
  const r = await puctSearch(gs, 100, net, { batchSize: 16 });
  const m = pickMove(r, 0.0);
  if (m === null) break;
  applyMove(gs, m);
  plies++;
}
const gameSec = (Date.now() - t1) / 1000;
const winner = computeWinner(gs);
console.log(`  plies:  ${plies}`);
console.log(`  winner: ${winner === 0 ? 'draw' : `Player ${winner}`}`);
console.log(`  time:   ${gameSec.toFixed(1)}s  (${(gameSec * 1000 / plies).toFixed(0)} ms/move)`);

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n✓ PUCT MCTS smoke test complete.');
console.log('  Next: real PUCT vs MCTS-RAVE tournament for production validation.');
