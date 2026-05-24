import { createContext, useCallback, useContext, useState } from 'react';

const GameExitContext = createContext({
  configs: {},
  registerExit: () => {},
  clearExit: () => {}
});

export function GameExitProvider({ children }) {
  const [configs, setConfigs] = useState({});

  const registerExit = useCallback((cfg) => {
    if (!cfg || !cfg.tabRoot) return;
    setConfigs((prev) => ({ ...prev, [cfg.tabRoot]: cfg }));
  }, []);

  const clearExit = useCallback((tabRoot) => {
    if (!tabRoot) return;
    setConfigs((prev) => {
      if (!(tabRoot in prev)) return prev;
      const next = { ...prev };
      delete next[tabRoot];
      return next;
    });
  }, []);

  return (
    <GameExitContext.Provider value={{ configs, registerExit, clearExit }}>
      {children}
    </GameExitContext.Provider>
  );
}

export const useGameExit = () => useContext(GameExitContext);
