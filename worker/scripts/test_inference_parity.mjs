// Run from repo root: node worker/scripts/test_inference_parity.mjs
// Verifies the JS-loaded ONNX model produces the same outputs as PyTorch did.
// Requires: cd worker && npm install --save-dev onnxruntime-node

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as ort from 'onnxruntime-node';
import { encodePlanes, IN_PLANES } from '../src/ai/azEncoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = resolve(__dirname, '../models/az_iter0_8x8.onnx');
const TEST_FILE = resolve(__dirname, '../models/parity_test_cases.json');

// Thresholds — chosen for AlphaZero policy+value nets in mind
const TOL_LOGIT  = 5e-3;   // raw logits can diverge a bit (CUDA vs CPU float)
const TOL_PROB   = 1e-4;   // softmax probabilities — what MCTS actually uses
const TOL_VALUE  = 1e-3;   // value head — passes through tanh, tight tolerance

function softmax(arr) {
  let m = -Infinity;
  for (const v of arr) if (v > m) m = v;
  const e = new Array(arr.length);
  let s = 0;
  for (let i = 0; i < arr.length; i++) { e[i] = Math.exp(arr[i] - m); s += e[i]; }
  for (let i = 0; i < arr.length; i++) e[i] /= s;
  return e;
}

function maxAbsDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

function argmax(arr) {
  let best = -Infinity, idx = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > best) { best = arr[i]; idx = i; }
  }
  return idx;
}

const tests = JSON.parse(readFileSync(TEST_FILE, 'utf-8'));
console.log(`Loaded ${tests.length} test cases.`);

console.log(`Loading model: ${MODEL_PATH}`);
const session = await ort.InferenceSession.create(MODEL_PATH);
console.log(`  inputs:  ${session.inputNames.join(', ')}`);
console.log(`  outputs: ${session.outputNames.join(', ')}\n`);

let passed = 0;
const failures = [];
let worstLogit = 0, worstProb = 0, worstValue = 0;

for (let i = 0; i < tests.length; i++) {
  const tc = tests[i];
  const planes = encodePlanes(tc.cells, tc.dead, tc.side, tc.phase, tc.last_idx, tc.size);

  const inputTensor = new ort.Tensor('float32', planes, [1, IN_PLANES, tc.size, tc.size]);
  const outputs = await session.run({ state: inputTensor });

  const ourLogits = Array.from(outputs.policy_logits.data);
  const ourValue = outputs.value.data[0];

  const expLogits = tc.expected_policy_logits;
  const expValue  = tc.expected_value;

  const logitDiff = maxAbsDiff(ourLogits, expLogits);
  const valueDiff = Math.abs(ourValue - expValue);
  const probDiff  = maxAbsDiff(softmax(ourLogits), softmax(expLogits));
  const argOurs   = argmax(ourLogits);
  const argExp    = argmax(expLogits);
  const argAgree  = argOurs === argExp;

  if (logitDiff > worstLogit) worstLogit = logitDiff;
  if (probDiff > worstProb)   worstProb  = probDiff;
  if (valueDiff > worstValue) worstValue = valueDiff;

  const ok = (logitDiff < TOL_LOGIT) && (probDiff < TOL_PROB)
          && (valueDiff < TOL_VALUE) && argAgree;

  if (ok) {
    passed++;
  } else {
    failures.push({ test: i, name: tc.name,
                    logitDiff, probDiff, valueDiff,
                    argOurs, argExp, argAgree });
  }
}

console.log(`Worst-case across all ${tests.length} cases:`);
console.log(`  logit diff: ${worstLogit.toExponential(2)}  (tol ${TOL_LOGIT})`);
console.log(`  prob diff:  ${worstProb.toExponential(2)}  (tol ${TOL_PROB})`);
console.log(`  value diff: ${worstValue.toExponential(2)}  (tol ${TOL_VALUE})`);

console.log(`\nResult: ${passed}/${tests.length} passed`);

if (failures.length > 0) {
  console.log(`\nFailures (first 5):`);
  for (const f of failures.slice(0, 5)) {
    console.log(`  [${f.test}] ${f.name}:`);
    console.log(`    logit=${f.logitDiff.toExponential(2)} prob=${f.probDiff.toExponential(2)} value=${f.valueDiff.toExponential(2)}`);
    console.log(`    argmax: ours=${f.argOurs} expected=${f.argExp} ${f.argAgree ? 'OK' : 'MISMATCH'}`);
  }
  process.exit(1);
} else {
  console.log('\n✓ Inference parity verified — JS ONNX produces same outputs as PyTorch.');
  console.log('\nNext: JS PUCT MCTS implementation (Phase 2 step 3).');
}
