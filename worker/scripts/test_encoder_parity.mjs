// Run from repo root: node worker/scripts/test_encoder_parity.mjs
// Verifies the JS encoder produces byte-identical output to Python encode_planes.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { encodePlanes, IN_PLANES } from '../src/ai/azEncoder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = resolve(__dirname, '../models/parity_test_cases.json');

const tests = JSON.parse(readFileSync(TEST_FILE, 'utf-8'));
console.log(`Loaded ${tests.length} parity test cases from ${TEST_FILE}\n`);

let passed = 0;
const failures = [];

for (let i = 0; i < tests.length; i++) {
  const tc = tests[i];
  const planes = encodePlanes(
    tc.cells, tc.dead, tc.side, tc.phase, tc.last_idx, tc.size
  );

  const n2 = tc.size * tc.size;
  const expected = new Float32Array(IN_PLANES * n2);
  let idx = 0;
  for (let c = 0; c < IN_PLANES; c++) {
    for (let r = 0; r < tc.size; r++) {
      for (let col = 0; col < tc.size; col++) {
        expected[idx++] = tc.expected_planes[c][r][col];
      }
    }
  }

  let mismatch = null;
  for (let j = 0; j < expected.length; j++) {
    if (planes[j] !== expected[j]) {
      mismatch = {
        flatIdx: j,
        plane: Math.floor(j / n2),
        row: Math.floor((j % n2) / tc.size),
        col: (j % n2) % tc.size,
        expected: expected[j],
        actual: planes[j],
      };
      break;
    }
  }

  if (mismatch) {
    failures.push({ test: i, name: tc.name, mismatch });
  } else {
    passed++;
  }
}

const total = tests.length;
console.log(`Result: ${passed}/${total} passed`);

if (failures.length > 0) {
  console.log(`\nFirst ${Math.min(5, failures.length)} failures:`);
  for (const f of failures.slice(0, 5)) {
    const m = f.mismatch;
    console.log(`  [${f.test}] ${f.name}: plane=${m.plane} row=${m.row} col=${m.col}  `
              + `expected=${m.expected}  actual=${m.actual}`);
  }
  process.exit(1);
} else {
  console.log('\n✓ Encoder parity verified — JS matches Python byte-for-byte.');
  console.log('\nNext: ONNX inference parity (Phase 2 step 2).');
}
