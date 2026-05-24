// Main-thread API for AI move selection. The actual search runs in a Web Worker
// so the UI stays responsive during 3-6s budgets.

import AISearchWorker from './aiSearch.worker.js?worker';
import { AI_TIERS, TIER_ORDER } from './aiTiers';

let worker = null;
let nextRequestId = 1;
const pending = new Map(); // requestId → { resolve, reject, signal, onAbort }

function ensureWorker() {
  if (worker) return worker;
  worker = new AISearchWorker();
  worker.onmessage = (e) => {
    const { type, requestId, move, error } = e.data || {};
    const p = pending.get(requestId);
    if (!p) return; // stale (cancelled before reply)
    pending.delete(requestId);
    if (p.signal && p.onAbort) p.signal.removeEventListener('abort', p.onAbort);
    if (type === 'result') p.resolve(move);
    else if (type === 'error') p.reject(new Error(error || 'AI worker error'));
    else p.resolve(null);
  };
  worker.onerror = (err) => {
    const e = new Error(err.message || 'AI worker crashed');
    for (const [, p] of pending) p.reject(e);
    pending.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

export function chooseAIMove({
  tier, state, size, phase, lastPlaces, currentPlayer, signal
}) {
  const cfg = AI_TIERS[tier];
  if (!cfg) return Promise.resolve(null);
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    pending.set(requestId, { resolve, reject, signal, onAbort });
    w.postMessage({
      type: 'search',
      requestId,
      tier,
      state,
      size,
      phase,
      lastPlaces,
      currentPlayer
    });
  });
}

export function disposeAI() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const [, p] of pending) {
    p.reject(new DOMException('Aborted', 'AbortError'));
  }
  pending.clear();
}

export { AI_TIERS, TIER_ORDER };
