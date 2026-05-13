#!/usr/bin/env node
// Long-lived stdio JSON-RPC bridge to the actual JS AI engine.
// Reads one JSON request per line on stdin, writes one response per line on stdout.
// Bundles the engine on launch via esbuild so Node can resolve the engine's
// extensionless imports (which Vite handles transparently in the app build).
//
// Request:  { id, cfg, state, size, phase, lastPlaces, currentPlayer }
//   `cfg` is a tier config object (same shape as values in AI_TIERS), e.g.
//   { kind: 'mctsrave', simBudget: 25000, timeMs: 8000, endgame: true }
//   { kind: 'puctaz',   simBudget: 25000, timeMs: 12000, modelUrl: '...' }
// Response: { id, move: { row, col } | null }  or { id, error }

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '_entry.js');
const repoRoot = path.resolve(here, '..', '..');

// Bundle once at startup (~100ms) and import the result via a data: URL so
// the harness always tunes the live engine source.
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

// Engine logs to console.* would corrupt our stdout RPC channel.
console.log = () => {};
console.warn = () => {};
console.error = () => {};

// ─── PUCTAZ lazy initialization ─────────────────────────────────────────
// The puctaz tier uses worker/src/ai/azMcts.js + a trained ONNX model.
// Loaded on first puctaz request, cached for the lifetime of this process.
let puctazPromise = null;
async function ensurePuctaz(modelUrl) {
  if (puctazPromise) return puctazPromise;
  puctazPromise = (async () => {
    const azNetUrl  = pathToFileURL(path.resolve(repoRoot, 'worker/src/ai/azNet.js')).href;
    const azMctsUrl = pathToFileURL(path.resolve(repoRoot, 'worker/src/ai/azMcts.js')).href;
    const azNetMod  = await import(azNetUrl);
    const azMctsMod = await import(azMctsUrl);
    const modelPath = path.resolve(repoRoot, modelUrl);
    const net = await azNetMod.AzNet.loadFromFile(modelPath);
    return { net, puctSearch: azMctsMod.puctSearch, pickMove: azMctsMod.pickMove };
  })();
  return puctazPromise;
}

function convertStateToAz(stateInput, size, phaseStr, currentPlayer, lastPlaces) {
  // aiEngineCore state format → azMcts state format
  const n2 = size * size;
  const cells = new Int8Array(n2);
  const dead  = new Uint8Array(n2);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const idx = r * size + c;
      const cell = stateInput[r][c];
      cells[idx] = cell.player === 1 ? 1 : cell.player === 2 ? 2 : 0;
      dead[idx]  = cell.eliminated ? 1 : 0;
    }
  }
  const phase = phaseStr === 'eliminate' ? 1 : 0;
  const side  = currentPlayer === 2 ? 2 : 1;
  const lastIdx = (phase === 1 && lastPlaces)
    ? lastPlaces.row * size + lastPlaces.col
    : -1;
  return { size, cells, dead, phase, side, lastIdx };
}

process.stdout.write(JSON.stringify({ ready: true }) + '\n');

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) void handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));

async function handle(line) {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, cfg, state, size, phase, lastPlaces, currentPlayer } = req;

  try {
    if (cfg && cfg.kind === 'puctaz') {
      const { net, puctSearch, pickMove } = await ensurePuctaz(cfg.modelUrl || 'worker/models/az_iter0_8x8.onnx');
      const azState = convertStateToAz(state, size, phase, currentPlayer, lastPlaces);
      const root = await puctSearch(azState, cfg.simBudget ?? 25000, net, {
        batchSize: cfg.batchSize ?? 32,
        cPuct: cfg.cPuct ?? 2.0,
        timeMs: cfg.timeMs ?? 12000,
      });
      const moveIdx = pickMove(root, 0.0);
      const out = (moveIdx === null || moveIdx === undefined || moveIdx < 0)
        ? null
        : { row: Math.floor(moveIdx / size), col: moveIdx % size };
      process.stdout.write(JSON.stringify({ id, move: out }) + '\n');
      return;
    }

    // Existing path: mctsrave / fixedab / oneply / idab via aiEngineCore.
    const tierKey = `__tune__${id}`;
    AI_TIERS[tierKey] = { ...cfg, reuseTree: false };
    const move = await chooseAIMove({
      tier: tierKey, state, size, phase, lastPlaces, currentPlayer
    });
    delete AI_TIERS[tierKey];
    process.stdout.write(JSON.stringify({ id, move: move || null }) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ id, error: String(err?.message || err) }) + '\n');
  }
}
