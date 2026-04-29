import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as fbSignOut
} from 'firebase/auth';
import { auth, googleProvider } from '../../firebase';
import { ensurePlayerProfile } from '../services/firebaseActions';

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
  const oneTapInitialized = useRef(false);
  const oneTapResolveRef = useRef(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setLoading(false);
      if (u && !isAllowedEmail(u.email)) {
        setUser(null);
        setError('Only @gmail.com accounts can sign in.');
        try {
          await fbSignOut(auth);
        } catch (e) {
          console.warn('Blocked account sign-out failed:', e);
        }
        return;
      }

      setUser(u);
      setError(null);

      if (u) {
        try {
          await ensurePlayerProfile();
        } catch (e) {
          console.warn('Profile init failed:', e);
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

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOut, promptOneTap }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
