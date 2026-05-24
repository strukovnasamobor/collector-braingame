import { useEffect, useRef, useState } from 'react';
import { LOCAL_TURN_TIME } from '../game/gameEngine';

export function useGameTimer({ enabled, turnKey, onTimeout }) {
  const [seconds, setSeconds] = useState(LOCAL_TURN_TIME);
  const timerRef = useRef(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  // One-shot gate against React StrictMode (and concurrent rendering generally)
  // double-invoking the setSeconds updater. Without this, the second invocation
  // queues a duplicate `onTimeoutRef.current()` microtask, the turn flips
  // twice, and the same player ends up with a fresh 30 s clock and TWO
  // timeout-count strikes. Reset on every turnKey change.
  const firedRef = useRef(false);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    firedRef.current = false;
    if (!enabled) return undefined;
    setSeconds(LOCAL_TURN_TIME);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          if (!firedRef.current) {
            firedRef.current = true;
            queueMicrotask(() => onTimeoutRef.current && onTimeoutRef.current());
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, turnKey]);

  return seconds;
}
