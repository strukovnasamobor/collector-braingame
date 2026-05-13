// Encoder for AlphaZero ValuePolicyNet input. Must match Python encode_planes
// in mcts_puct.py exactly — any drift silently breaks the model.

export const SIZE = 8;
export const IN_PLANES = 5;
export const PLANE_LEN = SIZE * SIZE;
export const TOTAL_LEN = IN_PLANES * PLANE_LEN;

export const PLACE = 0;
export const ELIMINATE = 1;

/**
 * Encode game state into a Float32Array of shape (IN_PLANES, size, size),
 * viewed from `side`'s POV. Layout is numpy C-order: 5 planes packed
 * contiguously, each plane row-major.
 *
 * Planes:
 *   0: my dots     (cells === side)
 *   1: opp dots    (cells === opp)
 *   2: dead cells  (dead !== 0)
 *   3: ELIMINATE-phase indicator (all 1.0 if phase===1, else all 0)
 *   4: last-placed dot marker (1.0 at lastIdx if phase===1 && lastIdx>=0)
 *
 * @param {Int8Array|number[]} cells    length size*size, values 0/1/2
 * @param {Uint8Array|number[]} dead    length size*size, values 0/1
 * @param {number} side                 1 or 2 (current player)
 * @param {number} phase                0=PLACE, 1=ELIMINATE
 * @param {number} lastIdx              -1 or 0..size*size-1
 * @param {number} size                 board size (default 8)
 * @returns {Float32Array}              length IN_PLANES * size*size
 */
export function encodePlanes(cells, dead, side, phase, lastIdx, size = SIZE) {
  const opp = side === 1 ? 2 : 1;
  const n2 = size * size;
  const out = new Float32Array(IN_PLANES * n2);

  const p0 = 0 * n2;
  const p1 = 1 * n2;
  const p2 = 2 * n2;
  for (let i = 0; i < n2; i++) {
    const c = cells[i];
    if (c === side)      out[p0 + i] = 1.0;
    else if (c === opp)  out[p1 + i] = 1.0;
    if (dead[i])         out[p2 + i] = 1.0;
  }

  if (phase === ELIMINATE) {
    const p3 = 3 * n2;
    out.fill(1.0, p3, p3 + n2);
    if (lastIdx >= 0) {
      out[4 * n2 + lastIdx] = 1.0;
    }
  }

  return out;
}
