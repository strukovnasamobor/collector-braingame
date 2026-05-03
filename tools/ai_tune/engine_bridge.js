#!/usr/bin/env node
// Long-lived stdio JSON-RPC bridge to the actual JS AI engine.
// Reads one JSON request per line on stdin, writes one response per line on stdout.
// Bundles the engine on launch via esbuild so Node can resolve the engine's
// extensionless imports (which Vite handles transparently in the app build).
//
// Request:  { id, cfg, state, size, phase, lastPlaces, currentPlayer }
//   `cfg` is a tier config object (same shape as values in AI_TIERS), e.g.
//   { kind: 'mctsrave', simBudget: 25000, timeMs: 8000, endgame: true }
// Response: { id, move: { row, col } | null }  or { id, error }

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '_entry.js');

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
  const tierKey = `__tune__${id}`;
  try {
    // reuseTree must be off — different games would otherwise share a stale
    // tree snapshot from a previous match's final position.
    AI_TIERS[tierKey] = { ...cfg, reuseTree: false };
    const move = await chooseAIMove({
      tier: tierKey, state, size, phase, lastPlaces, currentPlayer
    });
    delete AI_TIERS[tierKey];
    process.stdout.write(JSON.stringify({ id, move: move || null }) + '\n');
  } catch (err) {
    delete AI_TIERS[tierKey];
    process.stdout.write(JSON.stringify({ id, error: String(err?.message || err) }) + '\n');
  }
}
