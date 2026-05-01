import { useEffect } from 'react';
import './MilestoneCelebration.css';

const PLAYER_PALETTES = {
  1: ['#dc3545', '#ff6b3d', '#ffb347'],
  2: ['#007bff', '#3dd5f3', '#4cc9f0']
};
const MAX_PALETTE = ['#dc3545', '#ff6b3d', '#007bff', '#3dd5f3', '#ffd700'];
const PLAYER_COLOR = { 1: '#dc3545', 2: '#007bff' };

const NORMAL_DURATION_MS = 1500;
const MAX_DURATION_MS = 4000;

let sharedAudioCtx = null;
let activeMaster = null;
let lastFiredEventId = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

// C major scale across 5 octaves (C3..B7) — each index is one diatonic step.
const SCALE = (() => {
  const out = [];
  const ratios = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8]; // C D E F G A B
  const baseC3 = 130.81;
  for (let oct = 0; oct < 5; oct++) {
    for (const r of ratios) out.push(baseC3 * Math.pow(2, oct) * r);
  }
  return out;
})();

function noteAt(degree) {
  if (degree < 0) return SCALE[0];
  if (degree >= SCALE.length) return SCALE[SCALE.length - 1];
  return SCALE[degree];
}

// Each motif is a list of scale-degree offsets from a base; varied so consecutive
// milestones don't sound identical. Cycles through the array as level grows.
const MOTIFS = [
  [0, 4],          // tonic + perfect fifth (open)
  [0, 2, 4],       // major triad ascending
  [4, 2, 7],       // sol → mi → octave (gentle rise)
  [0, 4, 2, 7],    // do-sol-mi-do' (cascade with octave)
  [2, 0, 4],       // mi-do-sol (zigzag)
  [0, 7, 4],       // do-do'-sol (octave drop)
  [4, 0, 7],       // sol-do-do' (cadence)
  [0, 2, 4, 7]     // tonic-3rd-5th-octave (full arpeggio)
];

// Bell-like additive synthesis: stack sine harmonics with their own envelopes
// so high partials decay faster than the fundamental — chime/glockenspiel feel.
function playBellNote(ctx, destination, freq, startTime, duration, peakGain) {
  const harmonics = [
    { mul: 1.0, gain: 1.0, decay: duration },
    { mul: 2.0, gain: 0.45, decay: duration * 0.65 },
    { mul: 3.0, gain: 0.22, decay: duration * 0.45 },
    { mul: 4.01, gain: 0.1, decay: duration * 0.3 }
  ];

  harmonics.forEach(({ mul, gain, decay }) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * mul, startTime);
    osc.connect(g);
    g.connect(destination);

    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.exponentialRampToValueAtTime(peakGain * gain, startTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + decay);

    osc.start(startTime);
    osc.stop(startTime + decay + 0.05);
  });
}

function playShimmer(ctx, destination, startTime, duration) {
  const sparkles = 6;
  for (let i = 0; i < sparkles; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = 2000 + Math.random() * 2500;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, startTime);
    osc.connect(g);
    g.connect(destination);

    const at = startTime + (i * duration) / sparkles;
    const len = 0.3 + Math.random() * 0.25;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);

    osc.start(at);
    osc.stop(at + len + 0.05);
  }
}

function fadeOutAndDisconnect(ctx, master) {
  if (!master) return;
  try {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    const cur = master.gain.value || 0.0001;
    master.gain.setValueAtTime(cur, now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    setTimeout(() => {
      try {
        master.disconnect();
      } catch {
        /* noop */
      }
    }, 120);
  } catch {
    /* noop */
  }
}

function makeMasterBus(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.15;
  master.connect(comp);
  comp.connect(ctx.destination);
  return master;
}

function playChime(event) {
  // De-dupe: same event id should never fire twice (guards against parent
  // re-renders that re-run the celebration effect).
  if (event && event.id === lastFiredEventId) return;
  lastFiredEventId = event ? event.id : null;

  const ctx = getAudioContext();
  if (!ctx) return;

  // Cut off whatever was still ringing.
  fadeOutAndDisconnect(ctx, activeMaster);
  const master = makeMasterBus(ctx);
  activeMaster = master;

  const startBase = ctx.currentTime + 0.01;

  if (event.isMax) {
    // Big triumphant fanfare across two octaves, sustained climax + sparkle.
    const notes = [
      { f: 523.25, gap: 0.13, dur: 0.55 }, // C5
      { f: 659.25, gap: 0.13, dur: 0.5 },  // E5
      { f: 783.99, gap: 0.13, dur: 0.5 },  // G5
      { f: 1046.5, gap: 0.13, dur: 0.55 }, // C6
      { f: 1318.5, gap: 0.13, dur: 0.6 },  // E6
      { f: 1568.0, gap: 0.0,  dur: 1.4 }   // G6 sustain
    ];
    let cursor = startBase;
    notes.forEach(({ f, gap, dur }) => {
      playBellNote(ctx, master, f, cursor, dur, 0.5);
      cursor += gap;
    });
    playShimmer(ctx, master, startBase + 0.4, 1.2);
    return;
  }

  // Per-word variety: motif cycles, base pitch climbs the scale with the word
  // degree (the milestone's position in the word list, stable across grid sizes).
  // The same word ("Great", "Awesome", etc.) sounds the same on a 6×6 board as
  // on a 12×12 board, regardless of how many dots back it.
  const degree = Math.max(1, event.degree || 1);
  const motif = MOTIFS[(degree - 1) % MOTIFS.length];
  // Base scale position: starts around F4 for degree 1 ("Good") and walks up
  // two scale steps per degree. Capped so we don't run off the high end.
  const baseDegree = Math.min(SCALE.length - 8, 6 + degree * 2);

  let cursor = startBase;
  motif.forEach((offset, i) => {
    const isLast = i === motif.length - 1;
    const dur = isLast ? 0.7 : 0.2;
    const gap = isLast ? 0.0 : 0.11;
    const peak = isLast ? 0.55 : 0.45;
    playBellNote(ctx, master, noteAt(baseDegree + offset), cursor, dur, peak);
    cursor += gap;
  });
}

// Maps a word's degree (1-indexed position in the milestone list) to the exact
// burst-count + particles-per-burst pair the celebration should fire. Tiered
// so each new burst level resets to a smaller particle count, then climbs.
//   1-7   (Good..Awesome)     -> 1 burst,  10..70 particles
//   8-11  (Fabulous..Terrific) -> 2 bursts, 40..70 particles each
//   12-18 (Fantastic..Spectacular) -> 3 bursts, 50..110 each
//   19-26 (Extraordinary..Sublime) -> 4 bursts, 80..150 each
//   27+   (THE COLLECTOR)     -> 5 bursts, 200 each
function celebrationParams(degree) {
  if (degree >= 27) return { burstCount: 5, particlesPerBurst: 200 };
  if (degree >= 19) return { burstCount: 4, particlesPerBurst: (degree - 11) * 10 };
  if (degree >= 12) return { burstCount: 3, particlesPerBurst: (degree - 7) * 10 };
  if (degree >= 8) return { burstCount: 2, particlesPerBurst: (degree - 4) * 10 };
  return { burstCount: 1, particlesPerBurst: Math.max(10, degree * 10) };
}

function fireConfetti(confetti, event) {
  const colors = event.isMax ? MAX_PALETTE : PLAYER_PALETTES[event.player] || PLAYER_PALETTES[1];
  const degree = Math.max(1, event.degree || 1);
  const { burstCount, particlesPerBurst } = celebrationParams(degree);
  const spread = event.isMax ? 360 : Math.min(180, 80 + degree * 6);

  for (let i = 0; i < burstCount; i++) {
    setTimeout(() => {
      confetti({
        particleCount: particlesPerBurst,
        spread,
        startVelocity: event.isMax ? 60 : 55,
        origin: { x: 0.5, y: 0.5 },
        colors,
        disableForReducedMotion: false
      });
    }, i * 160);
  }
}

export default function MilestoneCelebration({ event, onDone }) {
  useEffect(() => {
    if (!event) return undefined;

    let cancelled = false;

    try {
      playChime(event);
    } catch (err) {
      console.warn('milestone chime failed', err);
    }

    // Confetti always fires, even when the OS requests reduced motion —
    // it's treated as a celebratory accent rather than essential animation.
    import('canvas-confetti')
      .then((mod) => {
        if (cancelled) return;
        fireConfetti(mod.default, event);
      })
      .catch((err) => {
        console.warn('canvas-confetti failed to load', err);
      });

    const duration = event.isMax ? MAX_DURATION_MS : NORMAL_DURATION_MS;

    const timer = setTimeout(() => {
      if (!cancelled) onDone?.();
    }, duration);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [event, onDone]);

  if (!event) return null;

  const color = PLAYER_COLOR[event.player] || PLAYER_COLOR[1];
  const stackClass = `sk-milestone-stack${event.isMax ? ' sk-milestone-stack--max' : ''}`;

  return (
    <div className="sk-milestone-overlay" aria-live="polite">
      <div key={event.id} className={stackClass} style={{ color, borderColor: color }}>
        {event.isMax ? (
          <>
            <div className="sk-milestone-tagline">One of a kind</div>
            <div className="sk-milestone-word">THE COLLECTOR</div>
          </>
        ) : (
          <>
            <div className="sk-milestone-word">{event.word}</div>
            <div className="sk-milestone-count">{event.level} dots collected</div>
          </>
        )}
      </div>
    </div>
  );
}
