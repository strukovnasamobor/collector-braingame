import { useEffect } from 'react';
import { playCoinTickerSound } from '../utils/coinSound';
import './CoinReward.css';

// Roughly the coin-flight window: t2 starts at 450 ms after mount, the
// 1400 ms transit + 490 ms stagger means the last coin lands at ~1890 ms
// after t2. 1500 ms of ticker covers the bulk of the visible flight.
const FLIGHT_DURATION_MS = 1500;

const COIN_COUNT = 8;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export default function CoinReward({ amount, onDone }) {
  useEffect(() => {
    // Tell AppHeader to freeze the wallet display at its pre-reward value while
    // the coins are flying. Released in Phase 3 below, when coins land.
    window.dispatchEvent(new CustomEvent('coin-reward-lock', { detail: { delta: amount } }));

    // Gold confetti burst using the same canvas-confetti already in the project
    import('canvas-confetti').then((mod) => {
      mod.default({
        particleCount: 55,
        spread: 90,
        startVelocity: 32,
        origin: { x: 0.5, y: 0.58 },
        colors: ['#f0b429', '#ffd700', '#ffec3d', '#f59e0b', '#fffde7'],
        disableForReducedMotion: true,
      });
    }).catch(() => {});

    // Find wallet position. The CoinBalance span is in the light DOM and is
    // unique to the wallet; walk up to its host <ion-button> for stable layout
    // dimensions. (Querying .sk-header-wallet-btn directly was unreliable —
    // Ionic's React wrapper doesn't always propagate className to the host
    // in time for the first paint, and the className occasionally landed on
    // a sibling button.)
    const innerSpan = document.querySelector('.sk-header-coins');
    const walletEl = innerSpan?.closest('ion-button') || innerSpan;
    const wr = walletEl?.getBoundingClientRect();
    const walletX = wr && wr.width > 0 ? wr.left + wr.width / 2 : window.innerWidth - 200;
    const walletY = wr && wr.height > 0 ? wr.top + wr.height / 2 : 30;

    // Coins start from screen centre (roughly where the game board is)
    const originX = window.innerWidth / 2;
    const originY = window.innerHeight * 0.55;
    const half = 13;

    // Create coins with small randomised start offsets so they don't perfectly
    // overlap, but keep them clustered near the centre — no outward burst.
    const coins = Array.from({ length: COIN_COUNT }, () => {
      const sx = originX + rand(-30, 30);
      const sy = originY + rand(-20, 20);
      const el = document.createElement('img');
      el.src = '/images/brain_coins.png';
      el.style.cssText =
        `position:fixed;width:26px;height:26px;` +
        `left:${sx - half}px;top:${sy - half}px;` +
        `z-index:9998;pointer-events:none;opacity:0;transition:none;`;
      document.body.appendChild(el);
      return el;
    });

    // Phase 1 — fade in (no movement)
    const raf = requestAnimationFrame(() => {
      coins.forEach((el) => {
        el.style.transition = 'opacity 0.25s ease-out';
        el.style.opacity = '1';
      });
    });

    // Phase 2 — fly straight toward the wallet (top-right) with stagger,
    // and start the ticker chirps so the audio tracks the visible flight.
    const t2 = setTimeout(() => {
      playCoinTickerSound(FLIGHT_DURATION_MS);
      coins.forEach((el, i) => {
        const delay = i * 70;
        el.style.transition =
          `left 1.4s ${delay}ms cubic-bezier(0.45,0.05,0.35,1),` +
          `top 1.4s ${delay}ms cubic-bezier(0.45,0.05,0.35,1),` +
          `opacity 0.35s ${delay + 1050}ms ease-in,` +
          `transform 1.4s ${delay}ms ease-in`;
        el.style.left      = `${walletX - half}px`;
        el.style.top       = `${walletY - half}px`;
        el.style.transform = 'scale(0.2)';
        el.style.opacity   = '0';
      });
    }, 450);

    // Phase 3 — coins land. Pulse the wallet AND release the lock so the
    // header counter animates from the old amount up to the new one.
    const t3 = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('coin-reward-unlock'));
      if (walletEl) {
        walletEl.classList.add('sk-wallet-pulse');
        setTimeout(() => walletEl.classList.remove('sk-wallet-pulse'), 600);
      }
    }, 2000);

    // Cleanup — keep the overlay long enough for the message to stay readable
    const tDone = setTimeout(() => {
      coins.forEach((el) => el.remove());
      onDone?.();
    }, 4500);

    return () => {
      // Safety: if we unmount mid-flight, make sure the wallet isn't left frozen.
      window.dispatchEvent(new CustomEvent('coin-reward-unlock'));
      cancelAnimationFrame(raf);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(tDone);
      coins.forEach((el) => el.remove());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sk-coin-reward-overlay" aria-live="polite">
      <div className="sk-coin-reward-stack">
        <div className="sk-coin-reward-label">
          +{amount.toLocaleString()} BGC
        </div>
      </div>
    </div>
  );
}
