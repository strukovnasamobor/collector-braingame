import {
  isValidPlacement,
  isValidElimination,
  applyPlace,
  applyEliminate,
  getBiggestGroup
} from './gameEngine';

export const AI_ALGORITHMS = ['greedy', 'defensive'];

const opponentOf = (player) => (player === 1 ? 2 : 1);

export function listValidPlacements(state, size) {
  const moves = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isValidPlacement(state, size, r, c)) moves.push({ row: r, col: c });
    }
  }
  return moves;
}

export function listValidEliminations(state, lastPlaces, size) {
  const moves = [];
  if (!lastPlaces) return moves;
  const r0 = lastPlaces.row;
  const c0 = lastPlaces.col;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      if (isValidElimination(state, lastPlaces, r, c)) moves.push({ row: r, col: c });
    }
  }
  return moves;
}

function countAdjacent(state, size, row, col, player) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      if (state[r][c].player === player) n++;
    }
  }
  return n;
}

// Pick from a candidate list using a primary score and an optional tiebreak.
// Ties at the top are broken randomly so games vary between runs.
function pickBest(candidates, scoreFn) {
  if (candidates.length === 0) return null;
  let best = -Infinity;
  let pool = [];
  for (const cand of candidates) {
    const s = scoreFn(cand);
    if (s > best) {
      best = s;
      pool = [cand];
    } else if (s === best) {
      pool.push(cand);
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function greedyPlace(state, size, currentPlayer) {
  const moves = listValidPlacements(state, size);
  return pickBest(moves, ({ row, col }) => {
    const ns = applyPlace(state, currentPlayer, row, col);
    const primary = getBiggestGroup(ns, size, currentPlayer);
    const tiebreak = countAdjacent(state, size, row, col, currentPlayer);
    return primary * 1000 + tiebreak;
  });
}

function greedyEliminate(state, size, lastPlaces, currentPlayer) {
  const opp = opponentOf(currentPlayer);
  const moves = listValidEliminations(state, lastPlaces, size);
  const oppBefore = getBiggestGroup(state, size, opp);
  return pickBest(moves, ({ row, col }) => {
    const ns = applyEliminate(state, row, col);
    const oppAfter = getBiggestGroup(ns, size, opp);
    return oppBefore - oppAfter;
  });
}

function defensivePlace(state, size, currentPlayer) {
  const opp = opponentOf(currentPlayer);
  const moves = listValidPlacements(state, size);
  if (moves.length === 0) return null;

  // First move (no opponent dots yet): pick a center-biased cell so the opening
  // isn't pathological. Score by negative distance from center.
  const oppHasAny = state.some((row) => row.some((c) => c.player === opp));
  if (!oppHasAny) {
    const mid = (size - 1) / 2;
    return pickBest(moves, ({ row, col }) => {
      const dr = row - mid;
      const dc = col - mid;
      return -(dr * dr + dc * dc);
    });
  }

  return pickBest(moves, ({ row, col }) => {
    const oppAdj = countAdjacent(state, size, row, col, opp);
    const ownAdj = countAdjacent(state, size, row, col, currentPlayer);
    return oppAdj * 4 - ownAdj;
  });
}

function defensiveEliminate(state, size, lastPlaces, currentPlayer) {
  return greedyEliminate(state, size, lastPlaces, currentPlayer);
}

export function chooseAIMove({
  algorithm,
  state,
  size,
  phase,
  lastPlaces,
  currentPlayer
}) {
  if (phase === 'place') {
    if (algorithm === 'defensive') return defensivePlace(state, size, currentPlayer);
    return greedyPlace(state, size, currentPlayer);
  }
  if (phase === 'eliminate') {
    if (algorithm === 'defensive') return defensiveEliminate(state, size, lastPlaces, currentPlayer);
    return greedyEliminate(state, size, lastPlaces, currentPlayer);
  }
  return null;
}
