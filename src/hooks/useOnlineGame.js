import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useFirestoreGame } from './useFirestoreGame';
import { normalizeHistory } from '../utils/coordinateNormalization';
import {
  applyEliminate,
  applyPlace,
  getBiggestGroup,
  isValidElimination,
  isValidPlacement
} from '../game/gameEngine';
import { getDisplayRatingFromProfile, normalizeSkillProfile } from '../game/skillRating';
import {
  claimGameTimeout,
  finalizeRankedResult,
  leaveOnlineGame,
  sendGameHeartbeat,
  submitGameMove,
  submitGameTimeout
} from '../services/firebaseActions';

const HEARTBEAT_INTERVAL_MS = 10 * 1000;
const CLAIM_TIMEOUT_POLL_MS = 5 * 1000;

export function useOnlineGame(gameId) {
  const { user } = useAuth();
  const { data, exists, error } = useFirestoreGame(gameId);
  const [localError, setLocalError] = useState('');
  const [ratings, setRatings] = useState({ 1: 1000, 2: 1000 });
  const [finalResult, setFinalResult] = useState(null);
  // Queue of unconfirmed moves applied locally. At most 2 entries:
  // [place] or [place, eliminate]. Sent to the server in order so the second
  // (eliminate) lands only after the first (place) is durable.
  const [pendingMoves, setPendingMoves] = useState([]);
  const submitChainRef = useRef(Promise.resolve());
  const ratingsFetchedRef = useRef(false);
  const eloHandledRef = useRef(false);

  const myPlayerNumber = useMemo(() => {
    if (!user || !data) return null;
    if (data.player1uid === user.uid) return 1;
    if (data.player2uid === user.uid) return 2;
    return null;
  }, [user, data]);

  const serverState = useMemo(() => {
    if (!data) return [];
    if (!data.gameStateJSON) {
      const size = data.gridSize;
      const s = [];
      for (let i = 0; i < size; i++) {
        const row = [];
        for (let j = 0; j < size; j++) row.push({ player: null, eliminated: false });
        s.push(row);
      }
      return s;
    }
    return JSON.parse(data.gameStateJSON);
  }, [data]);

  const state = useMemo(() => {
    if (serverState.length === 0) return serverState;
    let s = serverState;
    for (const m of pendingMoves) {
      if (m.kind === 'place') s = applyPlace(s, m.playerNumber, m.row, m.col);
      else s = applyEliminate(s, m.row, m.col);
    }
    return s;
  }, [serverState, pendingMoves]);

  const serverHistory = useMemo(() => {
    if (!data || !data.placementHistory) return { 1: [], 2: [] };
    return {
      1: normalizeHistory(data.placementHistory.p1),
      2: normalizeHistory(data.placementHistory.p2)
    };
  }, [data]);

  const history = useMemo(() => {
    const h = { 1: [...serverHistory[1]], 2: [...serverHistory[2]] };
    for (const m of pendingMoves) {
      if (m.kind === 'place') {
        h[m.playerNumber] = [...h[m.playerNumber], { row: m.row, col: m.col }];
      }
    }
    return h;
  }, [serverHistory, pendingMoves]);

  const scores = useMemo(() => {
    if (!data || state.length === 0) return { 1: 0, 2: 0 };
    return {
      1: getBiggestGroup(state, data.gridSize, 1),
      2: getBiggestGroup(state, data.gridSize, 2)
    };
  }, [state, data]);

  const phase = useMemo(() => {
    if (!data) return 'place';
    if (pendingMoves.length === 0) return data.phase;
    const last = pendingMoves[pendingMoves.length - 1];
    return last.kind === 'place' ? 'eliminate' : 'place';
  }, [data, pendingMoves]);

  const currentPlayer = useMemo(() => {
    if (!data) return 1;
    const hasOptimisticEliminate = pendingMoves.some((m) => m.kind === 'eliminate');
    if (hasOptimisticEliminate) {
      const me = pendingMoves[0].playerNumber;
      return me === 1 ? 2 : 1;
    }
    return data.currentPlayer;
  }, [data, pendingMoves]);

  // Optimistic lastPlaces (the cell whose elimination must be adjacent to).
  const lastPlaces = useMemo(() => {
    if (pendingMoves.length === 0) return data?.lastPlaces || null;
    const last = pendingMoves[pendingMoves.length - 1];
    if (last.kind === 'place') return { row: last.row, col: last.col };
    return null;
  }, [data, pendingMoves]);

  // Single per-turn timer: only resets when the active player flips, not on phase transition.
  const turnKey = data ? `${currentPlayer}` : '';

  // Reconcile: drop pending moves the server has confirmed.
  useEffect(() => {
    if (pendingMoves.length === 0 || !data) return;
    if (data.status !== 'active') {
      setPendingMoves([]);
      return;
    }
    const serverPlacementCount =
      (data.placementHistory?.p1?.length || 0) +
      (data.placementHistory?.p2?.length || 0);
    setPendingMoves((prev) => {
      const next = prev.filter((m) => {
        if (m.kind === 'place') {
          return serverPlacementCount < m.baselinePlacementCount;
        }
        // Eliminate is confirmed once the server flips currentPlayer to the opponent.
        return data.currentPlayer === m.playerNumber;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [data, pendingMoves.length]);

  useEffect(() => {
    if (!data || data.mode !== 'ranked' || ratingsFetchedRef.current) return;
    if (!data.player1uid || !data.player2uid) return;
    ratingsFetchedRef.current = true;
    Promise.all([
      getDoc(doc(db, 'players', data.player1uid)),
      getDoc(doc(db, 'players', data.player2uid))
    ])
      .then(([s1, s2]) => {
        setRatings({
          1: getDisplayRatingFromProfile(normalizeSkillProfile(s1.data() || {})),
          2: getDisplayRatingFromProfile(normalizeSkillProfile(s2.data() || {}))
        });
      })
      .catch(() => { });
  }, [data]);

  useEffect(() => {
    if (!gameId || !user || !myPlayerNumber) return;
    if (!data || data.status !== 'active') return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      sendGameHeartbeat({ gameId }).catch(() => {});
    };
    tick();
    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [gameId, user, myPlayerNumber, data?.status]);

  // Opponent-stalling defense: when it's NOT my turn and the active player has run past
  // their server-tracked deadline, claim the timeout so a non-cooperative client can't
  // freeze the game. Server validates the deadline; this is just the trigger.
  useEffect(() => {
    if (!gameId || !user || !myPlayerNumber || !data) return;
    if (data.status !== 'active') return;
    if (!data.timerEnabled) return;
    if (data.currentPlayer === myPlayerNumber) return;
    const deadline = Number(data.turnDeadlineMs);
    if (!Number.isFinite(deadline) || deadline <= 0) return;
    let cancelled = false;
    const tryClaim = () => {
      if (cancelled) return;
      if (Date.now() <= deadline) return;
      claimGameTimeout({ gameId }).catch(() => {});
    };
    tryClaim();
    const interval = setInterval(tryClaim, CLAIM_TIMEOUT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [gameId, user, myPlayerNumber, data]);

  useEffect(() => {
    if (!data || !data.result || !user || !myPlayerNumber) return;
    if (eloHandledRef.current) return;

    if (data.mode === 'casual') {
      eloHandledRef.current = true;
      setFinalResult(data.result);
      return;
    }

    if (data.result.delta1 != null && data.result.delta2 != null) {
      eloHandledRef.current = true;
      setRatings({ 1: data.result.newR1, 2: data.result.newR2 });
      setFinalResult(data.result);
      return;
    }

    if (myPlayerNumber !== 1) {
      return;
    }

    eloHandledRef.current = true;
    (async () => {
      try {
        const response = await finalizeRankedResult({ gameId });
        const result = response?.data?.result || data.result;
        if (result?.newR1 != null && result?.newR2 != null) {
          setRatings({ 1: result.newR1, 2: result.newR2 });
        }
        setFinalResult(result);
      } catch (e) {
        console.error('Rating update error:', e?.code || e?.message || 'unknown');
        setFinalResult(data.result);
      }
    })();
  }, [data, user, myPlayerNumber, gameId]);

  const placeDot = useCallback(
    (row, col) => {
      if (!data || !user || !myPlayerNumber) return;
      if (data.status !== 'active') return;
      if (currentPlayer !== myPlayerNumber) return;
      // Cap the queue at the place+eliminate pair for one turn.
      if (pendingMoves.length >= 2) return;

      const size = data.gridSize;
      const isPlacePhase = phase === 'place';

      const valid = isPlacePhase
        ? isValidPlacement(state, size, row, col)
        : isValidElimination(state, lastPlaces, row, col);
      if (!valid) {
        setLocalError(isPlacePhase ? 'game.invalid_placement' : 'game.must_eliminate_adjacent');
        return;
      }

      setLocalError('');

      const baseServerPlaces =
        (data.placementHistory?.p1?.length || 0) +
        (data.placementHistory?.p2?.length || 0);
      const optimisticPlaceCount = pendingMoves.filter((m) => m.kind === 'place').length;
      const baselinePlacementCount =
        baseServerPlaces + optimisticPlaceCount + (isPlacePhase ? 1 : 0);

      const newMove = {
        row,
        col,
        kind: isPlacePhase ? 'place' : 'eliminate',
        playerNumber: myPlayerNumber,
        baselinePlacementCount
      };
      setPendingMoves((prev) => [...prev, newMove]);

      // Send to the server in order: each click chains onto the previous send,
      // so an eliminate is only dispatched after its preceding place is durable.
      submitChainRef.current = submitChainRef.current
        .catch(() => {})
        .then(async () => {
          try {
            await submitGameMove({ gameId, row, col });
          } catch (e) {
            setPendingMoves((prev) => prev.filter((m) => m !== newMove));
            setLocalError('notifications.move_rejected');
            throw e;
          }
        });
    },
    [data, user, myPlayerNumber, gameId, state, phase, currentPlayer, pendingMoves, lastPlaces]
  );

  const onTimeout = useCallback(async () => {
    if (!data || !myPlayerNumber) return;
    if (data.status !== 'active') return;
    if (data.currentPlayer !== myPlayerNumber) return;
    try {
      await submitGameTimeout({ gameId });
    } catch (e) {
      setLocalError(e?.message || 'game.timeout_failed');
    }
  }, [data, myPlayerNumber, gameId]);

  const leaveGame = useCallback(async () => {
    if (!data || !user || !gameId) return;
    try {
      await leaveOnlineGame({ gameId });
    } catch (e) {
      console.warn('Leave game failed:', e?.code || e?.message || 'unknown');
    }
  }, [data, user, gameId]);

  return {
    data,
    exists,
    error,
    state,
    history,
    scores,
    myPlayerNumber,
    ratings,
    placeDot,
    onTimeout,
    leaveGame,
    turnKey,
    phase,
    currentPlayer,
    localError,
    finalResult
  };
}
