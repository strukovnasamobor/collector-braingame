import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from './AuthContext';
import { purchaseGridUnlock as purchaseGridUnlockCall } from '../services/firebaseActions';

const EconomyContext = createContext(null);

const DEFAULT_UNLOCKED_GRIDS = [6];
export const GRID_UNLOCK_COSTS = { 8: 1000, 10: 10000, 12: 100000 };

export function EconomyProvider({ children }) {
  const { user } = useAuth();
  const [coins, setCoins] = useState(0);
  const [onlineGrids, setOnlineGrids] = useState(DEFAULT_UNLOCKED_GRIDS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setCoins(0);
      setOnlineGrids(DEFAULT_UNLOCKED_GRIDS);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'players', user.uid),
      (snap) => {
        if (!snap.exists()) {
          setCoins(0);
          setOnlineGrids(DEFAULT_UNLOCKED_GRIDS);
        } else {
          const data = snap.data();
          setCoins(typeof data.coins === 'number' ? data.coins : 0);
          const grids = data?.unlocks?.onlineGrids;
          setOnlineGrids(
            Array.isArray(grids) && grids.length > 0
              ? grids.map(Number).filter((n) => Number.isFinite(n))
              : DEFAULT_UNLOCKED_GRIDS
          );
        }
        setLoading(false);
      },
      (err) => {
        console.warn('Economy snapshot failed:', err?.code || err?.message || 'unknown');
        setLoading(false);
      }
    );
    return unsub;
  }, [user]);

  const isGridUnlocked = useCallback(
    (size) => onlineGrids.includes(Number(size)),
    [onlineGrids]
  );

  const purchaseGridUnlock = useCallback(async (size) => {
    return purchaseGridUnlockCall({ size });
  }, []);

  const value = useMemo(
    () => ({ coins, onlineGrids, loading, isGridUnlocked, purchaseGridUnlock }),
    [coins, onlineGrids, loading, isGridUnlocked, purchaseGridUnlock]
  );

  return <EconomyContext.Provider value={value}>{children}</EconomyContext.Provider>;
}

export function useEconomy() {
  const ctx = useContext(EconomyContext);
  if (!ctx) throw new Error('useEconomy must be used inside EconomyProvider');
  return ctx;
}
