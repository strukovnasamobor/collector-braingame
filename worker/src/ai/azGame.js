// Game primitives for AlphaZero MCTS. Mirrors engine_az.py / az_selfplay.py.
// Mutating ops (applyMove) are in-place. MCTS uses state copies per sim.

export const PLACE = 0;
export const ELIMINATE = 1;

export function initialState(size = 8) {
  const n2 = size * size;
  return {
    size,
    cells: new Int8Array(n2),
    dead:  new Uint8Array(n2),
    phase: PLACE,
    side:  1,
    lastIdx: -1,
  };
}

export function applyMove(state, move) {
  if (state.phase === PLACE) {
    state.cells[move] = state.side;
    state.lastIdx = move;
    state.phase = ELIMINATE;
  } else {
    state.dead[move] = 1;
    state.lastIdx = -1;
    state.side = state.side === 1 ? 2 : 1;
    state.phase = PLACE;
  }
  return state;
}

export function genPlacements(cells, dead, size, out) {
  const n2 = size * size;
  let n = 0;
  for (let i = 0; i < n2; i++) {
    if (cells[i] !== 0 || dead[i] !== 0) continue;
    const r = (i / size) | 0;
    const c = i % size;
    let hasFree = false;
    for (let dr = -1; dr <= 1 && !hasFree; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const v = nr * size + nc;
        if (cells[v] === 0 && dead[v] === 0) { hasFree = true; break; }
      }
    }
    if (hasFree) out[n++] = i;
  }
  return n;
}

export function genEliminations(cells, dead, size, lastIdx, out) {
  if (lastIdx < 0) return 0;
  const lr = (lastIdx / size) | 0;
  const lc = lastIdx % size;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = lr + dr, c = lc + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const idx = r * size + c;
      if (cells[idx] === 0 && dead[idx] === 0) out[n++] = idx;
    }
  }
  return n;
}

export function biggestGroup(cells, size, player) {
  const n2 = size * size;
  const visited = new Uint8Array(n2);
  const stack   = new Int32Array(n2);
  let best = 0;
  for (let start = 0; start < n2; start++) {
    if (cells[start] !== player || visited[start]) continue;
    let count = 0, sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    while (sp > 0) {
      const u = stack[--sp];
      count++;
      const ur = (u / size) | 0;
      const uc = u % size;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = ur + dr, nc = uc + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const v = nr * size + nc;
          if (!visited[v] && cells[v] === player) {
            visited[v] = 1;
            stack[sp++] = v;
          }
        }
      }
    }
    if (count > best) best = count;
  }
  return best;
}

export function hasLegalMove(state) {
  const n2 = state.size * state.size;
  const buf = new Int32Array(n2);
  if (state.phase === PLACE) {
    return genPlacements(state.cells, state.dead, state.size, buf) > 0;
  }
  return genEliminations(state.cells, state.dead, state.size, state.lastIdx, buf) > 0;
}

export function computeWinner(state) {
  const a = biggestGroup(state.cells, state.size, 1);
  const b = biggestGroup(state.cells, state.size, 2);
  return a > b ? 1 : (b > a ? 2 : 0);
}
