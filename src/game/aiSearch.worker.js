// Self-contained search worker for the Collector AI.
// No React, no DOM, no Ionic — only Web Worker globals (self, postMessage).
// Move-gen mirrors gameEngine.isValidPlacement / isValidElimination on flat arrays.

import {
  AI_TIERS,
  ENDGAME_THRESHOLD,
  ENDGAME_SAFETY_MS,
  EVAL_MATERIAL,
  EVAL_EXT,
  EVAL_TOTAL,
  WIN_MAG
} from './aiTiers';

const PLACE = 0;
const ELIMINATE = 1;
const FLAG_EXACT = 0;
const FLAG_LOWER = 1;
const FLAG_UPPER = 2;
const INF = 1e9;
const MAX_PLY = 64;
const MAX_DEPTH = 32;
const TT_CAP = 500_000;
const HISTORY_OVERFLOW = 1 << 28;
const QS_CAP = 4;
const ENDGAME_TT_DEPTH = 99;

// ── Per-search mutable state ───────────────────────────────────────────────
let size = 0;
let N2 = 0;
let cells = null;       // Int8Array, 0=empty, 1=P1, 2=P2
let dead = null;        // Uint8Array, 0/1
let phase = PLACE;
let side = 1;
let lastIdx = -1;
let hashLo = 0;
let hashHi = 0;

let tt = null;          // Map<string, { depth, value, flag, move }>
let history = null;     // Float64Array of size 4*N2 — index = ((side-1)*2 + phase) * N2 + cell
let killers = null;     // Int16Array MAX_PLY*2 — slots per ply
let moveBufs = null;    // Array<Int16Array(N2)> per ply
let scoreBuf = null;    // Int32Array(N2) — scratch for ordering
let visitedBuf = null;  // Uint8Array(N2)
let stackBuf = null;    // Int16Array(N2)
let frontierBuf = null; // Uint8Array(N2)

let deadline = 0;
let timedOut = false;

// ── Zobrist (per-worker, sized for the largest board we've seen) ───────────
let zN2 = 0;
let Z_CELL_LO = null;   // Int32Array of size 3*N2 — [P1 | P2 | DEAD]
let Z_CELL_HI = null;
let Z_LAST_LO = null;   // Int32Array of size N2
let Z_LAST_HI = null;
let Z_PHASE_LO = 0;
let Z_PHASE_HI = 0;
let Z_SIDE_LO = 0;
let Z_SIDE_HI = 0;

function rand32() {
  return (Math.random() * 0x100000000) | 0;
}

function ensureZobrist() {
  if (Z_CELL_LO && zN2 === N2) return;
  zN2 = N2;
  Z_CELL_LO = new Int32Array(3 * N2);
  Z_CELL_HI = new Int32Array(3 * N2);
  for (let i = 0; i < 3 * N2; i++) { Z_CELL_LO[i] = rand32(); Z_CELL_HI[i] = rand32(); }
  Z_LAST_LO = new Int32Array(N2);
  Z_LAST_HI = new Int32Array(N2);
  for (let i = 0; i < N2; i++) { Z_LAST_LO[i] = rand32(); Z_LAST_HI[i] = rand32(); }
  Z_PHASE_LO = rand32(); Z_PHASE_HI = rand32();
  Z_SIDE_LO = rand32();  Z_SIDE_HI = rand32();
}

function computeInitialHash() {
  hashLo = 0; hashHi = 0;
  for (let i = 0; i < N2; i++) {
    if (cells[i] === 1)      { hashLo ^= Z_CELL_LO[i];               hashHi ^= Z_CELL_HI[i]; }
    else if (cells[i] === 2) { hashLo ^= Z_CELL_LO[N2 + i];          hashHi ^= Z_CELL_HI[N2 + i]; }
    else if (dead[i])        { hashLo ^= Z_CELL_LO[2 * N2 + i];      hashHi ^= Z_CELL_HI[2 * N2 + i]; }
  }
  if (phase === ELIMINATE) {
    hashLo ^= Z_PHASE_LO; hashHi ^= Z_PHASE_HI;
    if (lastIdx >= 0) { hashLo ^= Z_LAST_LO[lastIdx]; hashHi ^= Z_LAST_HI[lastIdx]; }
  }
  if (side === 2) { hashLo ^= Z_SIDE_LO; hashHi ^= Z_SIDE_HI; }
}

// ── apply / undo ───────────────────────────────────────────────────────────
function applyPlace(idx) {
  cells[idx] = side;
  const sIdx = (side - 1) * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[idx];  hashHi ^= Z_LAST_HI[idx];
  lastIdx = idx;
  phase = ELIMINATE;
}

function undoPlace(idx) {
  cells[idx] = 0;
  const sIdx = (side - 1) * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[idx];  hashHi ^= Z_LAST_HI[idx];
  lastIdx = -1;
  phase = PLACE;
}

function applyEliminate(idx) {
  dead[idx] = 1;
  const sIdx = 2 * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_LAST_LO[lastIdx]; hashHi ^= Z_LAST_HI[lastIdx];
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  side = side === 1 ? 2 : 1;
  hashLo ^= Z_SIDE_LO;       hashHi ^= Z_SIDE_HI;
  lastIdx = -1;
  phase = PLACE;
}

function undoEliminate(idx, prevLastIdx) {
  hashLo ^= Z_SIDE_LO;       hashHi ^= Z_SIDE_HI;
  side = side === 1 ? 2 : 1;
  hashLo ^= Z_PHASE_LO;      hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[prevLastIdx]; hashHi ^= Z_LAST_HI[prevLastIdx];
  lastIdx = prevLastIdx;
  dead[idx] = 0;
  const sIdx = 2 * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx]; hashHi ^= Z_CELL_HI[sIdx];
  phase = ELIMINATE;
}

// ── Move generation ────────────────────────────────────────────────────────
function hasAdjacentFreeIdx(idx) {
  const r = (idx / size) | 0;
  const c = idx - r * size;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const v = nr * size + nc;
      if (cells[v] === 0 && !dead[v]) return true;
    }
  }
  return false;
}

function genPlacements(buf) {
  let n = 0;
  for (let i = 0; i < N2; i++) {
    if (cells[i] !== 0 || dead[i]) continue;
    if (hasAdjacentFreeIdx(i)) buf[n++] = i;
  }
  return n;
}

function genEliminations(buf, lastI) {
  let n = 0;
  if (lastI < 0) return 0;
  const lr = (lastI / size) | 0;
  const lc = lastI - lr * size;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = lr + dr, c = lc + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const idx = r * size + c;
      if (cells[idx] === 0 && !dead[idx]) buf[n++] = idx;
    }
  }
  return n;
}

// ── Evaluation primitives ──────────────────────────────────────────────────
function biggestGroup(player) {
  let best = 0;
  visitedBuf.fill(0);
  for (let start = 0; start < N2; start++) {
    if (cells[start] !== player || visitedBuf[start]) continue;
    let count = 0;
    let sp = 0;
    stackBuf[sp++] = start;
    visitedBuf[start] = 1;
    while (sp > 0) {
      const u = stackBuf[--sp];
      count++;
      const ur = (u / size) | 0;
      const uc = u - ur * size;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = ur + dr, nc = uc + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const v = nr * size + nc;
          if (!visitedBuf[v] && cells[v] === player) {
            visitedBuf[v] = 1;
            stackBuf[sp++] = v;
          }
        }
      }
    }
    if (count > best) best = count;
  }
  return best;
}

// Returns the size of player's biggest connected group AND the count of empty
// non-dead cells 8-adjacent to that specific group. Two passes on visitedBuf:
// first pass finds the biggest group + its anchor cell; second pass walks that
// group only, counting frontier into frontierBuf.
function biggestGroupSizeAndFrontier(player) {
  visitedBuf.fill(0);
  let bestSize = 0;
  let bestAnchor = -1;
  for (let start = 0; start < N2; start++) {
    if (cells[start] !== player || visitedBuf[start]) continue;
    let count = 0;
    let sp = 0;
    stackBuf[sp++] = start;
    visitedBuf[start] = 1;
    const anchor = start;
    while (sp > 0) {
      const u = stackBuf[--sp];
      count++;
      const ur = (u / size) | 0;
      const uc = u - ur * size;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = ur + dr, nc = uc + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const v = nr * size + nc;
          if (!visitedBuf[v] && cells[v] === player) {
            visitedBuf[v] = 1;
            stackBuf[sp++] = v;
          }
        }
      }
    }
    if (count > bestSize) { bestSize = count; bestAnchor = anchor; }
  }
  if (bestAnchor < 0) return { size: 0, frontier: 0 };

  // Second pass: walk the biggest group, count empty/non-dead 8-neighbors.
  visitedBuf.fill(0);
  frontierBuf.fill(0);
  let sp = 0;
  stackBuf[sp++] = bestAnchor;
  visitedBuf[bestAnchor] = 1;
  let frontier = 0;
  while (sp > 0) {
    const u = stackBuf[--sp];
    const ur = (u / size) | 0;
    const uc = u - ur * size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = ur + dr, nc = uc + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const v = nr * size + nc;
        if (visitedBuf[v]) continue;
        if (cells[v] === player) {
          visitedBuf[v] = 1;
          stackBuf[sp++] = v;
        } else if (cells[v] === 0 && !dead[v] && !frontierBuf[v]) {
          frontierBuf[v] = 1;
          frontier++;
        }
      }
    }
  }
  return { size: bestSize, frontier };
}

function totalDots(player) {
  let n = 0;
  for (let i = 0; i < N2; i++) if (cells[i] === player) n++;
  return n;
}

function frontierCount(player) {
  let n = 0;
  frontierBuf.fill(0);
  for (let i = 0; i < N2; i++) {
    if (cells[i] !== player) continue;
    const r = (i / size) | 0;
    const c = i - r * size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const v = nr * size + nc;
        if (cells[v] === 0 && !dead[v] && !frontierBuf[v]) {
          frontierBuf[v] = 1;
          n++;
        }
      }
    }
  }
  return n;
}

function evaluate() {
  const opp = side === 1 ? 2 : 1;
  const me = biggestGroupSizeAndFrontier(side);
  const op = biggestGroupSizeAndFrontier(opp);
  const myCnt = totalDots(side);
  const opCnt = totalDots(opp);
  return EVAL_MATERIAL * (me.size - op.size)
       + EVAL_EXT      * (me.frontier - op.frontier)
       + EVAL_TOTAL    * (myCnt - opCnt);
}

// ── Move ordering / killers / history ──────────────────────────────────────
function countAdjacentDots(idx, who) {
  const r = (idx / size) | 0;
  const c = idx - r * size;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      if (cells[nr * size + nc] === who) n++;
    }
  }
  return n;
}

function isGrabMove(m) {
  if (phase === PLACE) return countAdjacentDots(m, side) > 0;
  return countAdjacentDots(m, side === 1 ? 2 : 1) > 0;
}

function histIdx(s, p, m) {
  return ((s - 1) * 2 + p) * N2 + m;
}

function bumpHistory(s, p, m, depth) {
  const i = histIdx(s, p, m);
  history[i] += depth * depth;
  if (history[i] > HISTORY_OVERFLOW) {
    for (let k = 0; k < history.length; k++) history[k] = history[k] / 2;
  }
}

function pushKiller(ply, m) {
  const k0 = killers[ply * 2];
  if (k0 === m) return;
  killers[ply * 2 + 1] = k0;
  killers[ply * 2] = m;
}

function orderMoves(buf, n, ttMove, ply) {
  const phaseIdx = phase === ELIMINATE ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    let s = 0;
    if (m === ttMove) s += 10_000_000;
    if (isGrabMove(m)) s += 100_000 + 10 * countAdjacentDots(m, phase === PLACE ? side : (side === 1 ? 2 : 1));
    if (m === killers[ply * 2]) s += 50_000;
    if (m === killers[ply * 2 + 1]) s += 25_000;
    s += history[histIdx(side, phaseIdx, m)] | 0;
    scoreBuf[i] = s;
  }
  // Insertion sort by descending score
  for (let i = 1; i < n; i++) {
    const m = buf[i], s = scoreBuf[i];
    let j = i - 1;
    while (j >= 0 && scoreBuf[j] < s) {
      buf[j + 1] = buf[j];
      scoreBuf[j + 1] = scoreBuf[j];
      j--;
    }
    buf[j + 1] = m;
    scoreBuf[j + 1] = s;
  }
}

// ── TT ─────────────────────────────────────────────────────────────────────
function ttKey() { return `${hashLo >>> 0}_${hashHi >>> 0}`; }

function ttStore(key, depth, value, flag, move) {
  if (tt.size > TT_CAP) {
    // Drop oldest 25% (Map iteration is insertion order)
    const target = (TT_CAP * 0.75) | 0;
    let toDrop = tt.size - target;
    for (const k of tt.keys()) {
      if (toDrop-- <= 0) break;
      tt.delete(k);
    }
  }
  tt.set(key, { depth, value, flag, move });
}

// ── Negamax (phase-aware: same side after place, toggles after eliminate) ──
function isNonQuiet() {
  return phase === PLACE && frontierCount(side) >= 2;
}

function negamax(depth, alpha, beta, ply, qsLeft) {
  if (timedOut) return 0;
  if (performance.now() >= deadline) { timedOut = true; return 0; }
  if (ply >= MAX_PLY - 1) return evaluate();

  const buf = moveBufs[ply];
  let n;
  const wasPhase = phase;
  if (wasPhase === PLACE) {
    n = genPlacements(buf);
    if (n === 0) {
      const diff = biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
      const sgn = diff > 0 ? 1 : diff < 0 ? -1 : 0;
      return sgn * WIN_MAG + diff - ply;
    }
  } else {
    n = genEliminations(buf, lastIdx);
    if (n === 0) return evaluate();
  }

  const key = ttKey();
  const e = tt.get(key);
  let ttMove = -1;
  if (e && e.depth >= depth && e.depth !== ENDGAME_TT_DEPTH) {
    if (e.flag === FLAG_EXACT) return e.value;
    if (e.flag === FLAG_LOWER && e.value >= beta) return e.value;
    if (e.flag === FLAG_UPPER && e.value <= alpha) return e.value;
  }
  if (e) ttMove = e.move;

  if (depth <= 0) {
    // TODO: re-enable quiescence with bounded branching (frontier-grab moves only).
    // The previous `negamax(2, ...)` extension recursed through the full move
    // generator and exploded the search budget on eliminate-root, leaving no
    // result before deadline.
    return evaluate();
  }

  orderMoves(buf, n, ttMove, ply);

  let best = -INF;
  let bestMove = -1;
  const aOrig = alpha;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) {
      v = negamax(depth - 1, alpha, beta, ply + 1, qsLeft);
    } else {
      v = -negamax(depth - 1, -beta, -alpha, ply + 1, qsLeft);
    }
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return 0;

    if (v > best) { best = v; bestMove = m; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) {
      if (!isGrabMove(m)) {
        pushKiller(ply, m);
        bumpHistory(side, wasPhase === PLACE ? 0 : 1, m, depth);
      }
      break;
    }
  }

  const flag = best <= aOrig ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
  ttStore(key, depth, best, flag, bestMove);
  return best;
}

// ── Root search (full window, records per-move scores for randomization) ──
function searchRoot(depth) {
  const buf = moveBufs[0];
  const wasPhase = phase;
  let n;
  if (wasPhase === PLACE) n = genPlacements(buf);
  else n = genEliminations(buf, lastIdx);
  if (n === 0) return null;

  const key = ttKey();
  const e = tt.get(key);
  const ttMove = (e && e.move >= 0) ? e.move : -1;
  orderMoves(buf, n, ttMove, 0);

  let best = -INF;
  let bestMove = -1;
  const scores = new Map();
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) v = negamax(depth - 1, -INF, INF, 1, QS_CAP);
    else v = -negamax(depth - 1, -INF, INF, 1, QS_CAP);
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return null;
    scores.set(m, v);
    if (v > best) { best = v; bestMove = m; }
  }
  return { bestMove, bestValue: best, scores };
}

function rootIDAB(budgetMs) {
  deadline = performance.now() + budgetMs;
  timedOut = false;
  let lastGood = null;
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const r = searchRoot(depth);
    if (timedOut) break;
    lastGood = r;
    if (r && Math.abs(r.bestValue) >= WIN_MAG) break;
  }
  return lastGood;
}

// ── Endgame solver (Expert only, terminal-only leaves) ─────────────────────
function endgameNegamax(alpha, beta, ply) {
  if (timedOut) return 0;
  if (performance.now() >= deadline) { timedOut = true; return 0; }
  if (ply >= MAX_PLY - 1) {
    return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  }

  const buf = moveBufs[ply];
  let n;
  const wasPhase = phase;
  if (wasPhase === PLACE) {
    n = genPlacements(buf);
    if (n === 0) {
      return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
    }
  } else {
    n = genEliminations(buf, lastIdx);
    if (n === 0) return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  }

  const key = ttKey();
  const e = tt.get(key);
  let ttMove = -1;
  if (e && e.depth === ENDGAME_TT_DEPTH) {
    if (e.flag === FLAG_EXACT) return e.value;
    if (e.flag === FLAG_LOWER && e.value >= beta) return e.value;
    if (e.flag === FLAG_UPPER && e.value <= alpha) return e.value;
  }
  if (e) ttMove = e.move;

  orderMoves(buf, n, ttMove, ply);

  let best = -INF;
  let bestMove = -1;
  const aOrig = alpha;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) v = endgameNegamax(alpha, beta, ply + 1);
    else v = -endgameNegamax(-beta, -alpha, ply + 1);
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return 0;
    if (v > best) { best = v; bestMove = m; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  const flag = best <= aOrig ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
  ttStore(key, ENDGAME_TT_DEPTH, best, flag, bestMove);
  return best;
}

function endgameRoot() {
  const buf = moveBufs[0];
  const wasPhase = phase;
  let n;
  if (wasPhase === PLACE) n = genPlacements(buf);
  else n = genEliminations(buf, lastIdx);
  if (n === 0) return null;

  orderMoves(buf, n, -1, 0);

  let best = -INF;
  let bestMove = -1;
  const scores = new Map();
  let alpha = -INF;
  const beta = INF;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    let v;
    if (wasPhase === PLACE) v = endgameNegamax(alpha, beta, 1);
    else v = -endgameNegamax(-beta, -alpha, 1);
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    if (timedOut) return null;
    scores.set(m, v);
    if (v > best) { best = v; bestMove = m; }
    if (v > alpha) alpha = v;
  }
  return { bestMove, bestValue: best, scores };
}

function runEndgame() {
  const t0 = performance.now();
  deadline = t0 + ENDGAME_SAFETY_MS;
  timedOut = false;
  const result = endgameRoot();
  if (timedOut) return null;
  return result;
}

// ── Beginner: pure 1-ply ───────────────────────────────────────────────────
function runOnePly() {
  const buf = moveBufs[0];
  const wasPhase = phase;
  const n = wasPhase === PLACE ? genPlacements(buf) : genEliminations(buf, lastIdx);
  if (n === 0) return null;
  const scores = new Map();
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE) applyPlace(m); else applyEliminate(m);
    // Eval is from current side-to-move's perspective.
    // After Place: side unchanged → eval is from our perspective (no negation).
    // After Eliminate: side flipped → eval is from opp perspective → negate.
    const raw = evaluate();
    const v = wasPhase === PLACE ? raw : -raw;
    if (wasPhase === PLACE) undoPlace(m); else undoEliminate(m, savedLastIdx);
    scores.set(m, v);
  }
  let best = -INF;
  for (const v of scores.values()) if (v > best) best = v;
  return { bestMove: null, bestValue: best, scores };
}

// ── Top-level dispatch + randomization ─────────────────────────────────────
function pickEps(scores, eps, epsMin) {
  if (!scores || scores.size === 0) return null;
  let best = -INF;
  for (const v of scores.values()) if (v > best) best = v;
  const tol = Math.max(epsMin, Math.abs(best) * eps);
  const pool = [];
  for (const [m, v] of scores) {
    if (v >= best - tol) pool.push(m);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function countEmpty() {
  let n = 0;
  for (let i = 0; i < N2; i++) if (cells[i] === 0 && !dead[i]) n++;
  return n;
}

function chooseMove(cfg) {
  if (cfg.kind === 'oneply') {
    const r = runOnePly();
    return pickEps(r?.scores, 0, 0);
  }

  if (cfg.endgame && countEmpty() <= ENDGAME_THRESHOLD) {
    const r = runEndgame();
    if (r) return pickEps(r.scores, 0, 0);
    // fall through to IDAB if endgame timed out
  }

  const r = rootIDAB(cfg.budgetMs);
  return pickEps(r?.scores, cfg.eps, cfg.epsMin);
}

// ── State init from input message ──────────────────────────────────────────
function initFromState(stateInput, gridSize, pPhase, lastPlaces, currentPlayer) {
  size = gridSize;
  N2 = size * size;
  cells = new Int8Array(N2);
  dead = new Uint8Array(N2);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const idx = r * size + c;
      const cell = stateInput[r][c];
      cells[idx] = cell.player === 1 ? 1 : cell.player === 2 ? 2 : 0;
      dead[idx] = cell.eliminated ? 1 : 0;
    }
  }
  phase = pPhase === 'eliminate' ? ELIMINATE : PLACE;
  side = currentPlayer === 2 ? 2 : 1;
  lastIdx = (phase === ELIMINATE && lastPlaces)
    ? lastPlaces.row * size + lastPlaces.col
    : -1;

  ensureZobrist();
  computeInitialHash();

  tt = new Map();
  history = new Float64Array(2 * 2 * N2);
  killers = new Int16Array(MAX_PLY * 2);
  killers.fill(-1);
  moveBufs = new Array(MAX_PLY);
  for (let p = 0; p < MAX_PLY; p++) moveBufs[p] = new Int16Array(N2);
  scoreBuf = new Int32Array(N2);
  visitedBuf = new Uint8Array(N2);
  stackBuf = new Int16Array(N2);
  frontierBuf = new Uint8Array(N2);
  timedOut = false;
}

// ── Worker message handler ─────────────────────────────────────────────────
self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'search') return;
  const { requestId, tier, state, size: gridSize, phase: pPhase, lastPlaces, currentPlayer } = msg;
  try {
    const cfg = AI_TIERS[tier];
    if (!cfg) {
      self.postMessage({ type: 'result', requestId, move: null });
      return;
    }
    initFromState(state, gridSize, pPhase, lastPlaces, currentPlayer);
    const moveIdx = chooseMove(cfg);
    if (moveIdx === null || moveIdx === undefined || moveIdx < 0) {
      self.postMessage({ type: 'result', requestId, move: null });
      return;
    }
    const r = (moveIdx / size) | 0;
    const c = moveIdx - r * size;
    self.postMessage({ type: 'result', requestId, move: { row: r, col: c } });
  } catch (err) {
    self.postMessage({ type: 'error', requestId, error: String((err && err.message) || err) });
  }
};
