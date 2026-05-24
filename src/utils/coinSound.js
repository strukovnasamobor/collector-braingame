let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTick(ctx, frequency, startTime, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.18, startTime + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

// Quick ascending chirps timed to overlap with the wallet count-up animation,
// so the player hears coins ticking into the wallet as the number climbs.
// `durationMs` should match the counter animation length.
export function playCoinTickerSound(durationMs = 600) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const seconds = Math.max(0.05, durationMs / 1000);
  const tickInterval = 0.05; // 50 ms between ticks → ~12 ticks for a 600 ms count
  const tickCount = Math.max(2, Math.round(seconds / tickInterval));
  // Ascending pitch — feels like a register tape rolling forward.
  const baseFreq = 880; // A5
  const step = 18;
  for (let i = 0; i < tickCount; i++) {
    playTick(ctx, baseFreq + i * step, now + i * tickInterval, 0.05);
  }
}
