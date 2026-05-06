import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

// `exists` stays `null` until we have a server-confirmed snapshot.
// With persistentLocalCache the SDK can deliver an initial
// `{exists: false, fromCache: true}` for a doc the local cache hasn't seen
// yet (notably the just-created game we're navigating to), and the consumer's
// redirect-on-`exists === false` path would bounce the user before the real
// server snapshot arrives. Treating `fromCache: true` snapshots as "still
// loading" preserves the in-game listener for live updates while guarding
// against the false-negative on first subscribe.
export function useFirestoreGame(gameId) {
  const [data, setData] = useState(null);
  const [exists, setExists] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!gameId) return undefined;
    setData(null);
    setExists(null);
    setError(null);
    const unsub = onSnapshot(
      doc(db, 'games', gameId),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) {
          if (snap.metadata.fromCache) return;
          setExists(false);
          setData(null);
          return;
        }
        setExists(true);
        setData(snap.data());
      },
      (err) => setError(err)
    );
    return unsub;
  }, [gameId]);

  return { data, exists, error };
}
