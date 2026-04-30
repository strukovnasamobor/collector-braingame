import { useEffect, useRef, useState } from 'react';
import { computeConnections, hasAdjacentFree } from '../game/gameEngine';
import { normalizeHistory } from '../utils/coordinateNormalization';

const P1_COLOR = '#dc3545';
const P2_COLOR = '#007bff';
const MIN_BOARD_MOBILE = 220;
const MIN_BOARD_DESKTOP = 180;
const MAX_BOARD_MOBILE = 430;
const MAX_BOARD_DESKTOP = 760;
const DESKTOP_BREAKPOINT = 900;

export default function GameBoard({ state, size, history, onCellClick, disabled, phase, lastPlaces }) {
  const wrapperRef = useRef(null);
  const measureRef = useRef(() => { });
  const [pixelSize, setPixelSize] = useState(MAX_BOARD_MOBILE);

  useEffect(() => {
    const measure = () => {
      if (!wrapperRef.current) return;
      const stage = wrapperRef.current.parentElement;
      const containerWidth = wrapperRef.current.clientWidth || stage?.clientWidth || 0;
      const width = Math.floor(containerWidth) - 2;
      const isDesktop = window.innerWidth >= DESKTOP_BREAKPOINT;
      const mobileTarget = Math.floor(window.innerWidth * 0.9);
      const maxBoard = isDesktop
        ? MAX_BOARD_DESKTOP
        : Math.min(MAX_BOARD_MOBILE, Math.max(MIN_BOARD_MOBILE, mobileTarget));
      const minBoard = isDesktop ? MIN_BOARD_DESKTOP : MIN_BOARD_MOBILE;

      const wrapperRect = wrapperRef.current.getBoundingClientRect();
      const timerHeight = stage?.querySelector('.sk-turn-timer')?.getBoundingClientRect().height || 0;
      const statusHeight = stage?.querySelector('.sk-status')?.getBoundingClientRect().height || 0;
      const tabBarHeight = document.querySelector('ion-tab-bar')?.getBoundingClientRect().height || 0;
      // Reserve enough headroom for status margin, board breathing room, and any
      // sub-pixel rounding so the bottom pill never overlaps the tab bar.
      const layoutReserve = 48;
      const bottomReserve = timerHeight + statusHeight + tabBarHeight + layoutReserve;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const availableHeight = Math.max(
        minBoard,
        Math.floor(viewportHeight - wrapperRect.top - bottomReserve)
      );
      const calculated = Math.min(maxBoard, Math.max(minBoard, Math.min(width, availableHeight)));
      setPixelSize(calculated);
    };
    measureRef.current = measure;

    // Initial measurement
    measure();

    // ResizeObserver for more reliable container-aware sizing
    const observer = new ResizeObserver(() => measure());
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }

    // Fallback to window resize for environments without ResizeObserver
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    measureRef.current();
  }, [size]);

  const cellPx = Math.floor(pixelSize / size);
  const totalPx = cellPx * size;
  const dotPx = Math.max(10, Math.floor(cellPx * 0.3));

  useEffect(() => {
    document.documentElement.style.setProperty('--dot-size', dotPx + 'px');
  }, [dotPx]);

  // Normalize incoming history to handle mixed formats (tuple, object, etc.)
  const historyForPlayer = (player) => {
    const raw = history?.[player] || [];
    return normalizeHistory(raw);
  };

  const lines1 = computeConnections(historyForPlayer(1));
  const lines2 = computeConnections(historyForPlayer(2));

  return (
    <div className="sk-grid-wrapper" ref={wrapperRef}>
      <div
        className="sk-grid"
        style={{
          width: totalPx,
          height: totalPx,
          gridTemplateColumns: `repeat(${size}, ${cellPx}px)`
        }}
      >
        {state.map((row, i) =>
          row.map((cell, j) => {
            // Eliminated and already-occupied cells are never valid targets in either phase,
            // so swallow the click here. Prevents the optimistic-flash + rollback flicker
            // that would otherwise happen when the server rejects the bad move with 412.
            const occupiedOrGone = cell.eliminated || cell.player !== null;
            let nonNeighborInEliminate = false;
            let unplaceableInPlace = false;
            if (!disabled && !occupiedOrGone) {
              if (phase === 'eliminate' && lastPlaces) {
                const dr = Math.abs(i - lastPlaces.row);
                const dc = Math.abs(j - lastPlaces.col);
                const isSelf = dr === 0 && dc === 0;
                const isNeighbor = !isSelf && dr <= 1 && dc <= 1;
                nonNeighborInEliminate = !isNeighbor;
              } else if (phase === 'place') {
                unplaceableInPlace = !hasAdjacentFree(state, size, i, j);
              }
            }
            const blocked = disabled || occupiedOrGone || nonNeighborInEliminate || unplaceableInPlace;
            return (
              <div
                key={`${i}-${j}`}
                className={`sk-cell${cell.eliminated ? ' eliminated' : ''}${blocked ? ' blocked' : ''}`}
                style={{
                  width: cellPx,
                  height: cellPx,
                  cursor: blocked ? 'not-allowed' : 'pointer'
                }}
                onClick={() => !blocked && onCellClick(i, j)}
              >
                {cell.player && (
                  <div
                    className="sk-dot"
                    style={{
                      backgroundColor: cell.player === 1 ? P1_COLOR : P2_COLOR,
                      width: dotPx,
                      height: dotPx
                    }}
                  />
                )}
              </div>
            );
          })
        )}

        <svg
          className="sk-connections-svg"
          width={totalPx}
          height={totalPx}
          viewBox={`0 0 ${totalPx} ${totalPx}`}
        >
          {lines1.map(([[r1, c1], [r2, c2]], idx) => (
            <line
              key={`p1-${idx}`}
              x1={(c1 + 0.5) * cellPx}
              y1={(r1 + 0.5) * cellPx}
              x2={(c2 + 0.5) * cellPx}
              y2={(r2 + 0.5) * cellPx}
              stroke={P1_COLOR}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.6}
            />
          ))}
          {lines2.map(([[r1, c1], [r2, c2]], idx) => (
            <line
              key={`p2-${idx}`}
              x1={(c1 + 0.5) * cellPx}
              y1={(r1 + 0.5) * cellPx}
              x2={(c2 + 0.5) * cellPx}
              y2={(r2 + 0.5) * cellPx}
              stroke={P2_COLOR}
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.6}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
