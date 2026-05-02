import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile
} from 'firebase/auth';
import { auth, googleProvider } from '../../firebase';
import { deleteUserProfile, ensurePlayerProfile, updateUserDisplayName } from '../services/firebaseActions';

const AuthContext = createContext(null);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function isAllowedEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
}

function waitForGoogleIdentity(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) {
      resolve(window.google.accounts.id);
      return;
    }
    const intervalMs = 100;
    let waited = 0;
    const handle = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(handle);
        resolve(window.google.accounts.id);
      } else if ((waited += intervalMs) >= timeoutMs) {
        clearInterval(handle);
        resolve(null);
      }
    }, intervalMs);
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Tracked separately from `user.displayName` so a successful rename forces
  // a re-render: Firebase mutates auth.currentUser.displayName in place,
  // which would otherwise be invisible to React because the user object
  // reference doesn't change.
  const [displayName, setDisplayName] = useState(null);
  const oneTapInitialized = useRef(false);
  const oneTapResolveRef = useRef(null);

  useEffect(() => {
    setDisplayName(user?.displayName || null);
  }, [user]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(false);
      if (u && !isAllowedEmail(u.email)) {
        setUser(null);
        setError('Only @gmail.com accounts can sign in.');
        try {
          await fbSignOut(auth);
        } catch (e) {
          console.warn('Blocked account sign-out failed:', e?.code || e?.message || 'unknown');
        }
        return;
      }

      setUser(u);
      setError(null);

      if (u) {
        try {
          await ensurePlayerProfile();
        } catch (e) {
          console.warn('Profile init failed:', e?.code || e?.message || 'unknown');
        }
      }
      try {
        window.dispatchEvent(new Event('auth-changed'));
      } catch (e) {
        // ignore in non-browser environments
      }
    });
    return unsub;
  }, []);

  const promptOneTap = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) return 'unavailable';
    if (auth.currentUser) return 'signed-in';

    const gis = await waitForGoogleIdentity();
    if (!gis) return 'unavailable';

    if (!oneTapInitialized.current) {
      gis.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          const resolve = oneTapResolveRef.current;
          oneTapResolveRef.current = null;
          if (!response?.credential) {
            if (resolve) resolve('cancelled');
            return;
          }
          setError(null);
          try {
            const cred = GoogleAuthProvider.credential(response.credential);
            const result = await signInWithCredential(auth, cred);
            if (!isAllowedEmail(result.user?.email)) {
              await fbSignOut(auth);
              setError('Only @gmail.com accounts can sign in.');
              if (resolve) resolve('blocked');
              return;
            }
            if (resolve) resolve('success');
          } catch (e) {
            setError(e.message);
            if (resolve) resolve('error');
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true
      });
      oneTapInitialized.current = true;
    }

    return new Promise((resolve) => {
      const prior = oneTapResolveRef.current;
      if (prior) prior('cancelled');
      oneTapResolveRef.current = resolve;

      gis.prompt((notification) => {
        const notDisplayed = notification.isNotDisplayed?.();
        const skipped = notification.isSkippedMoment?.();
        const dismissed = notification.isDismissedMoment?.();
        if (dismissed) {
          const reason = notification.getDismissedReason?.();
          if (reason === 'credential_returned') {
            // The credentials callback handles resolve.
            return;
          }
        }
        if (notDisplayed || skipped || dismissed) {
          if (oneTapResolveRef.current === resolve) {
            oneTapResolveRef.current = null;
            resolve('cancelled');
          }
        }
      });
    });
  }, []);

  const signInWithPopupFlow = useCallback(async () => {
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      if (!isAllowedEmail(credential.user?.email)) {
        await fbSignOut(auth);
        setError('Only @gmail.com accounts can sign in.');
      }
    } catch (e) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
        return;
      }
      setError(e.message);
    }
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    const result = await promptOneTap();
    if (result === 'success' || result === 'signed-in' || result === 'blocked') return;
    await signInWithPopupFlow();
  }, [promptOneTap, signInWithPopupFlow]);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    if (window.google?.accounts?.id) {
      try {
        window.google.accounts.id.disableAutoSelect();
      } catch (e) {
        // ignore
      }
    }
  }, []);

  // Deletes the user's player profile + queue presence on the server, then
  // signs out. Active games (involving the opponent) are intentionally
  // preserved. Firebase Auth account itself is left intact — signing back
  // in creates a fresh player doc at default rating.
  const deleteAccount = useCallback(async () => {
    try {
      await deleteUserProfile();
    } catch (e) {
      // Even if the server call fails, fall through to sign-out so the user
      // is at least no longer authenticated locally.
      console.warn('Profile delete failed:', e?.code || e?.message || 'unknown');
    }
    await fbSignOut(auth);
    if (window.google?.accounts?.id) {
      try {
        window.google.accounts.id.disableAutoSelect();
      } catch (_) {}
    }
  }, []);

  // Renames the signed-in user. Updates three things in order:
  //   1. Firebase Auth profile (so future ID tokens carry the new name and
  //      the worker's auto-sync on enqueue won't undo this rename).
  //   2. ID token refresh (forces the next backend call to see the new name).
  //   3. Worker's players/<uid>.displayName (so the leaderboard reflects it
  //      immediately, without waiting for the next ranked match).
  const updateDisplayName = useCallback(async (rawName) => {
    const u = auth.currentUser;
    if (!u) throw new Error('Not signed in.');
    const trimmed = (rawName || '').trim().slice(0, 32);
    if (!trimmed) throw new Error('Display name cannot be empty.');
    await updateProfile(u, { displayName: trimmed });
    try {
      await u.getIdToken(true);
    } catch (e) {
      // Best-effort; the worker will pick up the new name on the next refresh.
    }
    await updateUserDisplayName({ displayName: trimmed });
    setDisplayName(trimmed);
    return trimmed;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, error, displayName, signIn, signOut, promptOneTap, updateDisplayName, deleteAccount }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
