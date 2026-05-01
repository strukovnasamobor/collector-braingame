import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  createInitialState,
  isValidPlacement,
  isValidElimination,
  applyPlace,
  applyEliminate,
  computeGameResult,
  getBiggestGroup,
  LOCAL_MAX_TIMEOUTS
} from '../game/gameEngine';
import { chooseAIMove, disposeAI } from '../game/aiEngine';

const MIN_AI_VISIBLE_MS = 350;
const aiAlgoForPlayer = (cfg, player) =>
  player === 1 ? cfg?.player1AI : cfg?.player2AI;

const LocalGameContext = createContext(null);

const emptyHistory = () => ({ 1: [], 2: [] });

export function LocalGameProvider({ children }) {
  const [config, setConfig] = useState(null); // { player1Name, player2Name, gridSize, timerEnabled }
  const [state, setState] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const [phase, setPhase] = useState('place');
  const [lastPlaces, setLastPlaces] = useState(null);
  const [history, setHistory] = useState(emptyHistory());
  const [timeouts, setTimeouts] = useState({ 1: 0, 2: 0 });
  const [turnKey, setTurnKey] = useState(0);
  const [matchId, setMatchId] = useState(0);
  const [result, setResult] = useState(null); // { winner, score1, score2, message }

  const startGame = useCallback(
    ({ player1Name, player2Name, gridSize, timerEnabled, player1AI, player2AI }) => {
      setConfig({
        player1Name,
        player2Name,
        gridSize,
        timerEnabled,
        player1AI: player1AI ?? null,
        player2AI: player2AI ?? null
      });
      setState(createInitialState(gridSize));
      setCurrentPlayer(1);
      setPhase('place');
      setLastPlaces(null);
      setHistory(emptyHistory());
      setTimeouts({ 1: 0, 2: 0 });
      setTurnKey((k) => k + 1);
      setMatchId((m) => m + 1);
      setResult(null);
    },
    []
  );

  const resetGame = useCallback(() => {
    if (!config) return;
    setState(createInitialState(config.gridSize));
    setCurrentPlayer(1);
    setPhase('place');
    setLastPlaces(null);
    setHistory(emptyHistory());
    setTimeouts({ 1: 0, 2: 0 });
    setTurnKey((k) => k + 1);
    setMatchId((m) => m + 1);
    setResult(null);
  }, [config]);

  const clearGame = useCallback(() => {
    setConfig(null);
    setState([]);
    setCurrentPlayer(1);
    setPhase('place');
    setLastPlaces(null);
    setHistory(emptyHistory());
    setTimeouts({ 1: 0, 2: 0 });
    setResult(null);
    disposeAI();
  }, []);

  const finalize = useCallback(
    (gameResult) => {
      if (!config) return;
      setResult(gameResult);
    },
    [config]
  );

  const placeDot = useCallback(
    (row, col) => {
      if (!config || result) return;
      if (phase === 'place') {
        if (!isValidPlacement(state, config.gridSize, row, col)) return;
        const ns = applyPlace(state, currentPlayer, row, col);
        setState(ns);
        setHistory((h) => ({
          ...h,
          [currentPlayer]: [...h[currentPlayer], [row, col]]
        }));
        setLastPlaces({ row, col });
        setPhase('eliminate');
        setTimeouts((t) => ({ ...t, [currentPlayer]: 0 }));
        // Do NOT bump turnKey here: the place + eliminate share one 30s timer.
      } else if (phase === 'eliminate') {
        if (!isValidElimination(state, lastPlaces, row, col)) return;
        const ns = applyEliminate(state, row, col);
        const gr = computeGameResult(ns, config.gridSize);
        setState(ns);
        setLastPlaces(null);
        setPhase('place');
        if (gr) {
          finalize(gr);
        } else {
          setCurrentPlayer((p) => (p === 1 ? 2 : 1));
          setTurnKey((k) => k + 1);
        }
      }
    },
    [config, state, phase, currentPlayer, lastPlaces, result, finalize]
  );

  const onTimeout = useCallback(() => {
    if (!config || result) return;
    const newCount = (timeouts[currentPlayer] || 0) + 1;
    const nextTimeouts = { ...timeouts, [currentPlayer]: newCount };

    // If the timer expired during the eliminate sub-phase, the player's
    // just-placed dot is reverted (single per-turn budget; eliminate-timeout
    // rolls back the whole turn).
    let nextState = state;
    let nextHistory = history;
    if (phase === 'eliminate' && lastPlaces) {
      nextState = state.map((row) => row.map((cell) => ({ ...cell })));
      nextState[lastPlaces.row][lastPlaces.col].player = null;
      const playerHist = history[currentPlayer] ? history[currentPlayer].slice(0, -1) : [];
      nextHistory = { ...history, [currentPlayer]: playerHist };
    }

    if (newCount >= LOCAL_MAX_TIMEOUTS) {
      const s1 = getBiggestGroup(nextState, config.gridSize, 1);
      const s2 = getBiggestGroup(nextState, config.gridSize, 2);
      const winner = currentPlayer === 1 ? 2 : 1;
      setState(nextState);
      setHistory(nextHistory);
      setTimeouts(nextTimeouts);
      finalize({ winner, score1: s1, score2: s2, timeout: true, loser: currentPlayer });
      return;
    }

    setState(nextState);
    setHistory(nextHistory);
    setTimeouts(nextTimeouts);
    setCurrentPlayer((p) => (p === 1 ? 2 : 1));
    setPhase('place');
    setLastPlaces(null);
    setTurnKey((k) => k + 1);
  }, [config, state, history, phase, currentPlayer, lastPlaces, timeouts, result, finalize]);

  useEffect(() => {
    if (!config || result) return undefined;
    const tier = aiAlgoForPlayer(config, currentPlayer);
    if (!tier) return undefined;

    const ac = new AbortController();
    let cancelled = false;
    const t0 = performance.now();

    (async () => {
      try {
        const move = await chooseAIMove({
          tier,
          state,
          size: config.gridSize,
          phase,
          lastPlaces,
          currentPlayer,
          signal: ac.signal
        });
        if (cancelled || !move) return;
        const elapsed = performance.now() - t0;
        const wait = Math.max(0, MIN_AI_VISIBLE_MS - elapsed);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (cancelled) return;
        placeDot(move.row, move.col);
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('AI search failed', e);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [config, result, currentPlayer, phase, lastPlaces, state, placeDot]);

  const scores = useMemo(() => {
    if (!config || state.length === 0) return { 1: 0, 2: 0 };
    return {
      1: getBiggestGroup(state, config.gridSize, 1),
      2: getBiggestGroup(state, config.gridSize, 2)
    };
  }, [state, config]);

  const value = {
    config,
    state,
    currentPlayer,
    phase,
    lastPlaces,
    history,
    scores,
    result,
    turnKey,
    matchId,
    placeDot,
    startGame,
    resetGame,
    clearGame,
    onTimeout,
    isActive: !!config && !result,
    isAITurn: !!config && !result && !!aiAlgoForPlayer(config, currentPlayer)
  };

  return <LocalGameContext.Provider value={value}>{children}</LocalGameContext.Provider>;
}

export function useLocalGame() {
  const ctx = useContext(LocalGameContext);
  if (!ctx) throw new Error('useLocalGame must be used inside LocalGameProvider');
  return ctx;
}
