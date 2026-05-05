import { useEffect } from 'react';
import { playCoinSound } from '../utils/coinSound';
import './CoinReward.css';

const COIN_COUNT = 8;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export default function CoinReward({ amount, onDone }) {
  useEffect(() => {
    playCoinSound();

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

    // Find wallet position in the header. Prefer the IonButton wrapper —
    // it always has layout dimensions; the inner CoinBalance span sometimes
    // reports a zero-width box if Ionic's shadow DOM is mid-layout.
    const walletEl =
      document.querySelector('.sk-header-wallet-btn') ||
      document.querySelector('.sk-header-coins');
    const wr = walletEl?.getBoundingClientRect();
    const walletX = wr && wr.width > 0 ? wr.left + wr.width / 2 : window.innerWidth - 110;
    const walletY = wr && wr.height > 0 ? wr.top + wr.height / 2 : 30;
    console.log('[CoinReward] wallet target:', { found: !!walletEl, walletX, walletY, rect: wr });

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

    // Phase 2 — fly straight toward the wallet (top-right) with stagger
    const t2 = setTimeout(() => {
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

    // Phase 3 — wallet pulse when first coins arrive
    const t3 = setTimeout(() => {
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
