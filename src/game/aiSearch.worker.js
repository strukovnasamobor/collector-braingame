// Browser Web Worker shim around the shared AI engine core.
// Delegates all search work to chooseAIMove() in ./aiEngineCore. The same core
// is also imported by the server-side Cloudflare Worker (worker/src/ai/...),
// so move quality is identical online and offline.

import { chooseAIMove } from './aiEngineCore';

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'search') return;
  const { requestId, tier, state, size, phase, lastPlaces, currentPlayer } = msg;
  try {
    const move = chooseAIMove({ tier, state, size, phase, lastPlaces, currentPlayer });
    self.postMessage({ type: 'result', requestId, move });
  } catch (err) {
    self.postMessage({ type: 'error', requestId, error: String((err && err.message) || err) });
  }
};
