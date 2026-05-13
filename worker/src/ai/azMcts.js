// PUCT MCTS with batched leaf evaluation. Mirrors mcts_puct.py.
// The net is called once per batch (default K=16 leaves), with virtual
// loss applied during descents to discourage re-selecting the same path.

import { encodePlanes, IN_PLANES } from './azEncoder.js';
import { PLACE, ELIMINATE,
         genPlacements, genEliminations, biggestGroup } from './azGame.js';

const C_PUCT_DEFAULT = 2.0;

export class PUCTNode {
  constructor(parent, move, toMove, phase, prior = 0) {
    this.parent = parent;
    this.move = move;
    this.toMove = toMove;
    this.phase = phase;
    this.children = [];
    this.prior = prior;
    this.visits = 0;
    this.totalScore = 0;
    this.virtualVisits = 0;
    this.expanded = false;
  }
}

function selectChild(node, cPuct) {
  const nParent = node.visits + node.virtualVisits;
  const sqrtN = Math.sqrt(Math.max(1, nParent));
  let bestScore = -Infinity;
  let best = null;
  for (const c of node.children) {
    const cv = c.visits + c.virtualVisits;
    let q = 0;
    if (cv > 0) {
      q = (c.totalScore - c.virtualVisits) / cv;
      if (c.toMove !== node.toMove) q = -q;
    }
    const u = cPuct * c.prior * sqrtN / (1 + cv);
    const score = q + u;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

function descendOne(root, rootState, cPuct, moveBuf) {
  const size = rootState.size;
  const cells   = new Int8Array(rootState.cells);
  const dead    = new Uint8Array(rootState.dead);
  let phase     = rootState.phase;
  let side      = rootState.side;
  let lastIdx   = rootState.lastIdx;

  const path = [root];
  root.virtualVisits += 1;
  let node = root;

  while (node.expanded && node.children.length > 0) {
    const child = selectChild(node, cPuct);
    if (!child) break;
    child.virtualVisits += 1;
    const m = child.move;
    if (phase === PLACE) {
      cells[m] = side;
      lastIdx = m;
      phase = ELIMINATE;
    } else {
      dead[m] = 1;
      lastIdx = -1;
      side = side === 1 ? 2 : 1;
      phase = PLACE;
    }
    path.push(child);
    node = child;
  }

  let nLegal;
  if (phase === PLACE) {
    nLegal = genPlacements(cells, dead, size, moveBuf);
  } else {
    nLegal = genEliminations(cells, dead, size, lastIdx, moveBuf);
  }
  const terminal = nLegal === 0;
  const legalMoves = terminal ? null : Array.from(moveBuf.subarray(0, nLegal));

  return { path, terminal, leafState: { cells, dead, phase, side, lastIdx, legalMoves } };
}

function expandAndBackprop(path, leafState, policyLogits, netValue, isTerminal, size) {
  const { cells, dead, phase, side, lastIdx, legalMoves } = leafState;
  const leafNode = path[path.length - 1];

  let leafValue;
  if (isTerminal) {
    const me = biggestGroup(cells, size, side);
    const op = biggestGroup(cells, size, side === 1 ? 2 : 1);
    leafValue = me > op ? 1.0 : (me < op ? -1.0 : 0.0);
  } else {
    if (!leafNode.expanded) {
      // Softmax over legal logits only
      let maxLogit = -Infinity;
      for (const m of legalMoves) {
        if (policyLogits[m] > maxLogit) maxLogit = policyLogits[m];
      }
      const priors = new Array(legalMoves.length);
      let sum = 0;
      for (let j = 0; j < legalMoves.length; j++) {
        const e = Math.exp(policyLogits[legalMoves[j]] - maxLogit);
        priors[j] = e;
        sum += e;
      }
      for (let j = 0; j < legalMoves.length; j++) {
        const m = legalMoves[j];
        const childToMove = phase === PLACE ? side : (side === 1 ? 2 : 1);
        const childPhase  = phase === PLACE ? ELIMINATE : PLACE;
        const child = new PUCTNode(leafNode, m, childToMove, childPhase, priors[j] / sum);
        leafNode.children.push(child);
      }
      leafNode.expanded = true;
    }
    leafValue = netValue;
  }

  // Backprop leaf→root, flipping sign when toMove changes
  let s = leafValue;
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i];
    n.virtualVisits -= 1;
    n.visits += 1;
    n.totalScore += s;
    if (i > 0 && path[i - 1].toMove !== n.toMove) s = -s;
  }
}

// Marsaglia–Tsang gamma sampler (for Dirichlet noise at root during self-play)
function sampleGamma(alpha, rng) {
  if (alpha < 1) {
    return sampleGamma(alpha + 1, rng) * Math.pow(rng(), 1 / alpha);
  }
  const d = alpha - 1/3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do {
      const u1 = rng(), u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function dirichletSample(alpha, n, rng) {
  const out = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    out[i] = sampleGamma(alpha, rng);
    sum += out[i];
  }
  for (let i = 0; i < n; i++) out[i] /= sum;
  return out;
}

export function addDirichletNoise(root, alpha = 0.3, eps = 0.25, rng = Math.random) {
  if (root.children.length === 0) return;
  const noise = dirichletSample(alpha, root.children.length, rng);
  for (let i = 0; i < root.children.length; i++) {
    root.children[i].prior = (1 - eps) * root.children[i].prior + eps * noise[i];
  }
}

/**
 * Run PUCT MCTS.
 * @param {object} state            { size, cells, dead, phase, side, lastIdx }
 * @param {number} simBudget        total simulations
 * @param {AzNet} net               loaded model wrapper
 * @param {object} opts
 * @param {number} opts.batchSize         leaves per net.forward call (default 16)
 * @param {number} opts.cPuct             PUCT exploration constant (default 2.0)
 * @param {boolean} opts.dirichletAtRoot  inject Dirichlet noise after root expand (self-play)
 * @param {number} opts.dirichletAlpha    default 0.3
 * @param {number} opts.dirichletEps      default 0.25
 * @param {function} opts.rng             ()→[0,1) random source
 * @returns {Promise<PUCTNode>}     root after simBudget sims
 */
export async function puctSearch(state, simBudget, net, opts = {}) {
  const batchSize        = opts.batchSize        ?? 16;
  const cPuct            = opts.cPuct            ?? C_PUCT_DEFAULT;
  const dirichletAtRoot  = opts.dirichletAtRoot  ?? false;
  const dirichletAlpha   = opts.dirichletAlpha   ?? 0.3;
  const dirichletEps     = opts.dirichletEps     ?? 0.25;
  const rng              = opts.rng              ?? Math.random;

  const size = state.size;
  const n2 = size * size;
  const root = new PUCTNode(null, -1, state.side, state.phase, 1.0);
  const moveBuf = new Int32Array(n2);

  let simsDone = 0;
  let noiseInjected = false;

  while (simsDone < simBudget) {
    const thisBatch = Math.min(batchSize, simBudget - simsDone);
    const descents = [];
    for (let i = 0; i < thisBatch; i++) {
      descents.push(descendOne(root, state, cPuct, moveBuf));
    }

    const ntIndices = [];
    for (let i = 0; i < descents.length; i++) {
      if (!descents[i].terminal) ntIndices.push(i);
    }

    let policyArr = null, valueArr = null;
    if (ntIndices.length > 0) {
      const K = ntIndices.length;
      const planeStride = IN_PLANES * n2;
      const batchPlanes = new Float32Array(K * planeStride);
      for (let bi = 0; bi < K; bi++) {
        const { cells, dead, phase, side, lastIdx } = descents[ntIndices[bi]].leafState;
        batchPlanes.set(
          encodePlanes(cells, dead, side, phase, lastIdx, size),
          bi * planeStride
        );
      }
      const result = await net.forward(batchPlanes, K);
      policyArr = result.policyLogits;
      valueArr  = result.values;
    }

    let ntIter = 0;
    for (let i = 0; i < descents.length; i++) {
      const { path, terminal, leafState } = descents[i];
      if (terminal) {
        expandAndBackprop(path, leafState, null, null, true, size);
      } else {
        const offset = ntIter * n2;
        const logitsView = policyArr.subarray(offset, offset + n2);
        expandAndBackprop(path, leafState, logitsView, valueArr[ntIter], false, size);
        ntIter++;
      }
      simsDone++;
    }

    if (dirichletAtRoot && !noiseInjected && root.expanded) {
      addDirichletNoise(root, dirichletAlpha, dirichletEps, rng);
      noiseInjected = true;
    }
  }

  return root;
}

export function rootVisitDistribution(root, nCells) {
  const pi = new Float32Array(nCells);
  let total = 0;
  for (const c of root.children) {
    pi[c.move] = c.visits;
    total += c.visits;
  }
  if (total > 0) for (let i = 0; i < nCells; i++) pi[i] /= total;
  return { pi, total };
}

export function pickMove(root, temperature = 0.0, rng = Math.random) {
  if (root.children.length === 0) return null;

  if (temperature === 0.0) {
    let best = -1;
    const ties = [];
    for (const c of root.children) {
      if (c.visits > best) {
        best = c.visits;
        ties.length = 0;
        ties.push(c.move);
      } else if (c.visits === best) {
        ties.push(c.move);
      }
    }
    if (ties.length === 1) return ties[0];
    return ties[(rng() * ties.length) | 0];
  }

  let max = 0;
  for (const c of root.children) if (c.visits > max) max = c.visits;
  if (max === 0) return root.children[(rng() * root.children.length) | 0].move;

  const weights = new Array(root.children.length);
  let sum = 0;
  for (let i = 0; i < root.children.length; i++) {
    weights[i] = Math.pow(root.children[i].visits, 1 / temperature);
    sum += weights[i];
  }
  let r = rng() * sum;
  for (let i = 0; i < root.children.length; i++) {
    r -= weights[i];
    if (r <= 0) return root.children[i].move;
  }
  return root.children[root.children.length - 1].move;
}
