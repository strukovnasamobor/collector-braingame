import { useEffect, useRef, useState } from 'react';
import { computeConnections, hasAdjacentFree, isValidElimination, isValidPlacement } from '../game/gameEngine';
import { normalizeHistory } from '../utils/coordinateNormalization';

const P1_COLOR = '#dc3545';
const P2_COLOR = '#007bff';
const MIN_BOARD_MOBILE = 220;
const MIN_BOARD_DESKTOP = 180;
const MAX_BOARD_MOBILE = 430;
const MAX_BOARD_DESKTOP = 760;
const DESKTOP_BREAKPOINT = 900;

const PULSE_STEP_MS = 70;
const PULSE_MAX_DELAY_MS = 1500;
const cellKey = (r, c) => `${r}-${c}`;

// BFS from (sr,sc) across same-player 8-connected cells, recording visit order.
// Returns Map<"r-c", visitIndex>. visitIndex 0 is the seed cell.
function bfsConnectedOrder(state, size, player, sr, sc) {
  const order = new Map();
  if (!state[sr] || !state[sr][sc] || state[sr][sc].player !== player) return order;
  const queue = [[sr, sc]];
  order.set(cellKey(sr, sc), 0);
  let counter = 1;
  while (queue.length) {
    const [r, c] = queue.shift();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
        const k = cellKey(nr, nc);
        if (order.has(k)) continue;
        const cell = state[nr][nc];
        if (!cell || cell.player !== player) continue;
        order.set(k, counter++);
        queue.push([nr, nc]);
      }
    }
  }
  return order;
}

export default function GameBoard({
  state,
  size,
  history,
  animationHistory,
  onCellClick,
  onDisabledClick,
  disabled,
  phase,
  lastPlaces
}) {
  const wrapperRef = useRef(null);
  const measureRef = useRef(() => { });
  const [pixelSize, setPixelSize] = useState(MAX_BOARD_MOBILE);
  const prevCountsRef = useRef({ 1: 0, 2: 0 });
  const pulseIdRef = useRef(0);
  const [pulse, setPulse] = useState(null); // { id, player, order: Map }
  // invalidNonce > 0 while the "invalid eliminate target" hint animation runs:
  // the just-placed dot pulses and the valid neighbour cells glow.
  const [invalidNonce, setInvalidNonce] = useState(0);

  useEffect(() => {
    if (invalidNonce === 0) return undefined;
    const timer = setTimeout(() => setInvalidNonce(0), 700);
    return () => clearTimeout(timer);
  }, [invalidNonce]);

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

  const h1 = historyForPlayer(1);
  const h2 = historyForPlayer(2);
  const lines1 = computeConnections(h1);
  const lines2 = computeConnections(h2);

  // Detect a new placement and trigger a "wave" pulse across the connected group.
  // Drives off the live `history`, which in online mode includes optimistic
  // pending places (see useOnlineGame's `history` memo) — so the pulse fires
  // the moment the player taps, not when the Firestore snapshot catches up.
  // If a pending place is rejected, `state[pr][pc].player` is null again by
  // the time this effect re-runs, so the `state[pr]?.[pc]?.player === placedBy`
  // guard below suppresses the pulse for the rolled-back cell. The
  // `animationHistory` prop is kept as an escape hatch for any future caller
  // that needs server-only animation timing.
  const detectionHistory = animationHistory || history;
  const detectH1 = normalizeHistory(detectionHistory?.[1] || []);
  const detectH2 = normalizeHistory(detectionHistory?.[2] || []);

  useEffect(() => {
    const counts = { 1: detectH1.length, 2: detectH2.length };
    const prev = prevCountsRef.current;
    let placedBy = null;
    let placedAt = null;

    if (counts[1] > prev[1]) {
      placedBy = 1;
      placedAt = detectH1[detectH1.length - 1];
    } else if (counts[2] > prev[2]) {
      placedBy = 2;
      placedAt = detectH2[detectH2.length - 1];
    }

    prevCountsRef.current = counts;

    // Reset on game start (history shrunk to 0 for both players).
    if (counts[1] === 0 && counts[2] === 0) {
      setPulse(null);
      return;
    }

    if (placedBy && Array.isArray(placedAt) && state && state.length) {
      const [pr, pc] = placedAt;
      if (state[pr]?.[pc]?.player === placedBy) {
        const order = bfsConnectedOrder(state, size, placedBy, pr, pc);
        pulseIdRef.current += 1;
        setPulse({ id: pulseIdRef.current, player: placedBy, order });
      }
    }
    // detectionHistory is the trigger; state is read live for BFS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectionHistory]);

  const pulseDelay = (visitIndex) =>
    Math.min(visitIndex * PULSE_STEP_MS, PULSE_MAX_DELAY_MS);

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

            const pulseOrder =
              pulse && pulse.player === cell.player
                ? pulse.order.get(cellKey(i, j))
                : undefined;
            const showHint = invalidNonce > 0;
            const isLastPlacedCell =
              !!(lastPlaces && i === lastPlaces.row && j === lastPlaces.col);
            const isValidEliminateNeighbour =
              showHint && phase === 'eliminate' && isValidElimination(state, lastPlaces, i, j);
            const isValidPlaceTarget =
              showHint && phase === 'place' && isValidPlacement(state, size, i, j);
            const showHintGlow = isValidEliminateNeighbour || isValidPlaceTarget;
            const showAttention =
              showHint && isLastPlacedCell && cell.player !== null;
            const dotKey = showAttention
              ? `attn-${invalidNonce}-${i}-${j}`
              : pulseOrder !== undefined
                ? `pulse-${pulse.id}-${i}-${j}`
                : `static-${i}-${j}`;
            const dotStyle = {
              backgroundColor: cell.player === 1 ? P1_COLOR : P2_COLOR,
              width: dotPx,
              height: dotPx
            };
            if (pulseOrder !== undefined) {
              dotStyle.animationDelay = `${pulseDelay(pulseOrder)}ms`;
            }
            const cellClassName = [
              'sk-cell',
              cell.eliminated ? 'eliminated' : '',
              blocked ? 'blocked' : '',
              showHintGlow ? 'sk-cell--neighbour-glow' : ''
            ].filter(Boolean).join(' ');
            const dotClassName = [
              'sk-dot',
              pulseOrder !== undefined ? 'sk-dot--pulse' : '',
              showAttention ? 'sk-dot--invalid-attention' : ''
            ].filter(Boolean).join(' ');

            return (
              <div
                key={`${i}-${j}`}
                className={cellClassName}
                style={{
                  width: cellPx,
                  height: cellPx,
                  cursor: blocked ? 'not-allowed' : 'pointer'
                }}
                onClick={() => {
                  if (blocked) {
                    if (disabled) {
                      // Board is locked (opponent's / AI's turn or game over) — let
                      // the page pulse the status text so the player notices.
                      onDisabledClick && onDisabledClick();
                    } else {
                      // Any tap on a non-playable cell while the board is interactive
                      // triggers the "where you can play" hint:
                      //   - eliminate phase -> glow valid eliminate neighbours
                      //   - place phase     -> glow valid placement cells
                      // Covers non-adjacent, occupied, eliminated, and isolated cells.
                      setInvalidNonce((n) => n + 1);
                    }
                    return;
                  }
                  onCellClick(i, j);
                }}
              >
                {cell.player && (
                  <div
                    key={dotKey}
                    className={dotClassName}
                    style={dotStyle}
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
          {lines1.map(([[r1, c1], [r2, c2]], idx) => {
            const inPulse =
              pulse && pulse.player === 1 &&
              pulse.order.has(cellKey(r1, c1)) &&
              pulse.order.has(cellKey(r2, c2));
            const lineKey = inPulse ? `p1-pulse-${pulse.id}-${idx}` : `p1-${idx}`;
            const style = inPulse
              ? { animationDelay: `${pulseDelay(Math.max(pulse.order.get(cellKey(r1, c1)), pulse.order.get(cellKey(r2, c2))))}ms` }
              : undefined;
            return (
              <line
                key={lineKey}
                className={inPulse ? 'sk-connection sk-connection--pulse' : 'sk-connection'}
                x1={(c1 + 0.5) * cellPx}
                y1={(r1 + 0.5) * cellPx}
                x2={(c2 + 0.5) * cellPx}
                y2={(r2 + 0.5) * cellPx}
                stroke={P1_COLOR}
                strokeWidth={3}
                strokeLinecap="round"
                opacity={0.6}
                style={style}
              />
            );
          })}
          {lines2.map(([[r1, c1], [r2, c2]], idx) => {
            const inPulse =
              pulse && pulse.player === 2 &&
              pulse.order.has(cellKey(r1, c1)) &&
              pulse.order.has(cellKey(r2, c2));
            const lineKey = inPulse ? `p2-pulse-${pulse.id}-${idx}` : `p2-${idx}`;
            const style = inPulse
              ? { animationDelay: `${pulseDelay(Math.max(pulse.order.get(cellKey(r1, c1)), pulse.order.get(cellKey(r2, c2))))}ms` }
              : undefined;
            return (
              <line
                key={lineKey}
                className={inPulse ? 'sk-connection sk-connection--pulse' : 'sk-connection'}
                x1={(c1 + 0.5) * cellPx}
                y1={(r1 + 0.5) * cellPx}
                x2={(c2 + 0.5) * cellPx}
                y2={(r2 + 0.5) * cellPx}
                stroke={P2_COLOR}
                strokeWidth={3}
                strokeLinecap="round"
                opacity={0.6}
                style={style}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
