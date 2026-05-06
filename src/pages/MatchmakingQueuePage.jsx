import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import {
    IonPage,
    IonContent,
    IonButton,
    IonIcon,
    IonSpinner
} from '@ionic/react';
import { closeCircleOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useGameExit } from '../contexts/GameExitContext';
import {
    enqueueForMatch,
    listenForMatch,
    tryFindMatch,
    cancelMatchmaking,
    heartbeatMatchmaking
} from '../hooks/matchmakingService';
import { validateGame } from '../hooks/matchmakingService';

function useQuery() {
    return new URLSearchParams(useLocation().search);
}

const ALLOWED_GRID_SIZES = [4, 6, 8, 10, 12];

export default function MatchmakingQueuePage() {
    const { t } = useI18n();
    const { user, loading } = useAuth();
    const history = useHistory();
    const { mode } = useParams();
    const location = useLocation();
    const query = useQuery();
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);

    // Ionic's IonRouterOutlet keeps this component mounted in the background
    // after navigating to the game page, so `useLocation` here tracks the
    // *current* URL (e.g. /online/game/...) rather than this route. Effects
    // that read URL state must gate on actually being on the matchmaking
    // route — otherwise a stale "missing gridSize" check would bounce the
    // user out of the just-started game.
    const onMatchmakingRoute = location.pathname.startsWith('/online/matchmaking/');

    const safeMode = useMemo(
        () => (mode === 'ranked' || mode === 'standard' ? mode : 'standard'),
        [mode]
    );

    // Standard mode requires an explicit ?gridSize= param. If it's missing or
    // invalid, send the user back to the lobby rather than silently picking a
    // default — the lobby owns grid selection.
    const gridParam = query.get('gridSize');
    const rawGridSize = gridParam == null ? null : Number(gridParam);
    const standardGridSize = ALLOWED_GRID_SIZES.includes(rawGridSize) ? rawGridSize : null;

    useEffect(() => {
        if (!loading && !user) history.replace('/online/auth');
    }, [loading, user, history]);

    useEffect(() => {
        if (!onMatchmakingRoute) return;
        if (safeMode === 'standard' && standardGridSize == null) {
            history.replace('/online/lobby');
        }
    }, [onMatchmakingRoute, safeMode, standardGridSize, history]);

    useEffect(() => {
        if (!user) return undefined;
        if (safeMode === 'standard' && standardGridSize == null) return undefined;

        let active = true;
        let trying = false;
        let unsubscribe = () => { };
        let retryTimer = null;
        let heartbeatTimer = null;
        // Precise one-shot retry scheduled from the worker's `retryAfterMs`
        // hint when /run returns null because bots aren't yet eligible. The
        // worker computes the remaining wait against its own joinedAtMs, so
        // this lands right at the threshold without client/worker clock
        // skew or enqueue-overhead guesswork.
        let preciseRetryTimer = null;
        let lastRedirectedGameId = null;
        let queueWasPresent = false;
        let reEnqueuing = false;

        const schedulePreciseRetry = (delayMs) => {
            if (!active) return;
            if (preciseRetryTimer) window.clearTimeout(preciseRetryTimer);
            preciseRetryTimer = window.setTimeout(() => {
                preciseRetryTimer = null;
                if (!active) return;
                void attemptMatch();
            }, Math.max(0, delayMs));
        };

        const attemptMatch = async () => {
            if (trying) return;
            trying = true;
            try {
                const result = await tryFindMatch({ userId: user.uid, mode: safeMode });
                if (active && result.gameId) {
                    const ok = await validateGame({ gameId: result.gameId });
                    if (ok) history.replace(`/online/game/${result.gameId}`);
                } else if (active && result.retryAfterMs > 0) {
                    // Worker told us exactly when bots become eligible. Use
                    // that instead of the generic 5s armTimers retry.
                    schedulePreciseRetry(result.retryAfterMs);
                }
            } catch (_) {
                // Keep searching; transient failures (incl. 429s) shouldn't stop retries.
            } finally {
                trying = false;
            }
        };

        const armTimers = () => {
            if (retryTimer) window.clearInterval(retryTimer);
            if (heartbeatTimer) window.clearInterval(heartbeatTimer);
            retryTimer = window.setInterval(() => {
                if (!active) return;
                void attemptMatch();
            }, 5000);
            heartbeatTimer = window.setInterval(() => {
                if (!active) return;
                void heartbeatMatchmaking(safeMode).catch(() => { });
            }, 20000);
        };

        const disarmTimers = () => {
            if (retryTimer) { window.clearInterval(retryTimer); retryTimer = null; }
            if (heartbeatTimer) { window.clearInterval(heartbeatTimer); heartbeatTimer = null; }
        };

        const reEnqueue = async () => {
            if (reEnqueuing) return;
            reEnqueuing = true;
            try {
                const isRanked = safeMode === 'ranked';
                await enqueueForMatch({
                    user,
                    mode: safeMode,
                    gridSize: isRanked ? 8 : standardGridSize,
                    timerEnabled: true
                });
                queueWasPresent = true;
            } catch (e) {
                if (!active) return;
                // While the tab was hidden, the user may have been matched (or
                // already had an active game). Redirect rather than silently
                // staying stuck on the queue page.
                const reconnectId = e?.data?.activeGameId;
                if (reconnectId) {
                    history.replace(`/online/game/${reconnectId}`);
                    return;
                }
                // Any other failure → bail to lobby; the user can retry.
                history.replace('/online/lobby');
            } finally {
                reEnqueuing = false;
            }
        };

        const onVisibility = () => {
            if (!active) return;
            if (document.visibilityState === 'visible') {
                armTimers();
                void attemptMatch();
                void heartbeatMatchmaking(safeMode).catch(() => { });
            } else {
                disarmTimers();
            }
        };

        const start = async () => {
            try {
                // Always cancel any previous matchmaking to clear stale queue state.
                // The worker enqueue handler accepts overwrite of stale entries, so no
                // propagation sleep is needed here.
                await cancelMatchmaking(user.uid, safeMode);

                const isRanked = safeMode === 'ranked';
                await enqueueForMatch({
                    user,
                    mode: safeMode,
                    gridSize: isRanked ? 8 : standardGridSize,
                    // Online games (both ranked and standard) always run with the timer.
                    timerEnabled: true
                });
                queueWasPresent = true;

                unsubscribe = listenForMatch(user.uid, safeMode, async (queueEntry) => {
                    if (!active) return;
                    if (queueEntry) {
                        queueWasPresent = true;
                        if (queueEntry.status === 'matched' && queueEntry.gameId) {
                            if (queueEntry.gameId !== lastRedirectedGameId) {
                                lastRedirectedGameId = queueEntry.gameId;
                                try {
                                    const ok = await validateGame({ gameId: queueEntry.gameId });
                                    if (ok) history.replace(`/online/game/${queueEntry.gameId}`);
                                } catch (_) {
                                    // ignore invalid or transient errors
                                }
                            }
                        }
                        return;
                    }
                    // queueEntry is null — our doc is gone. If we previously had one
                    // and the page is visible, re-establish presence at the user's
                    // selected grid size. (Likely a server-side stale-prune after a
                    // long background interval.)
                    if (queueWasPresent && document.visibilityState === 'visible') {
                        queueWasPresent = false;
                        void reEnqueue();
                    }
                });

                // attemptMatch handles its own precise-retry scheduling via the
                // worker's `retryAfterMs` response, so there's nothing else to
                // schedule here — armTimers' 5s ticks are the safety net for
                // any case the precise retry doesn't cover (e.g. tab visibility
                // pauses).
                await attemptMatch();

                if (document.visibilityState === 'visible') armTimers();
                document.addEventListener('visibilitychange', onVisibility);
            } catch (e) {
                if (!active) return;
                const reconnectId = e?.data?.activeGameId;
                if (reconnectId) {
                    history.replace(`/online/game/${reconnectId}`);
                    return;
                }
                const code = e?.data?.code;
                if (code === 'GRID_LOCKED') {
                    setError(t('coins.grid_locked'));
                    return;
                }
                setError(e.message || t('lobby.matchmaking_error'));
            }
        };

        start();

        return () => {
            active = false;
            document.removeEventListener('visibilitychange', onVisibility);
            unsubscribe();
            disarmTimers();
            if (preciseRetryTimer) {
                window.clearTimeout(preciseRetryTimer);
                preciseRetryTimer = null;
            }
            // Best-effort: tear down the queue entry server-side so a remount
            // (StrictMode / route churn / bfcache) starts from a clean slate.
            // Server is authoritative; we don't await.
            void cancelMatchmaking(user.uid, safeMode).catch(() => { });
        };
    }, [
        user,
        safeMode,
        standardGridSize,
        history,
        t
    ]);

    const cancel = useCallback(async () => {
        if (!user || cancelling) {
            history.replace('/online/lobby');
            return;
        }
        setCancelling(true);
        try {
            await cancelMatchmaking(user.uid, safeMode);
        } catch (_) {
            // Ignore cancellation errors and return to lobby.
        } finally {
            history.replace('/online/lobby');
        }
    }, [user, cancelling, safeMode, history]);

    const { registerExit, clearExit } = useGameExit();
    // useLayoutEffect runs synchronously after commit, before paint — so the exit
    // config is registered before the user can possibly tap the online tab. With a
    // regular useEffect there's a window where exitConfigs['/online'] is missing
    // and TabBar would fall back to a generic alert (or, before the TabBar fix,
    // silently navigate to the lobby).
    useLayoutEffect(() => {
        registerExit({
            tabRoot: '/online',
            title: t('lobby.stop_search_title'),
            message: t('lobby.stop_search_message'),
            onConfirm: cancel
        });
        return () => clearExit('/online');
    }, [registerExit, clearExit, cancel, t]);

    const modeLabel =
        safeMode === 'ranked' ? t('lobby.matchmaking_ranked') : t('lobby.matchmaking_standard');

    return (
        <IonPage>
            <AppHeader />
            <IonContent fullscreen>
                <div className="sk-menu-content">
                    <div className="sk-lobby-panel">
                        <p style={{ textAlign: 'center', marginTop: 0, fontWeight: 700 }}>
                            {t('lobby.matchmaking_title')}
                        </p>
                        <p style={{ textAlign: 'center', marginTop: 2 }}>{modeLabel}</p>
                        <div style={{ textAlign: 'center', margin: '12px 0' }}>
                            <IonSpinner />
                        </div>
                        <p style={{ textAlign: 'center', marginBottom: 0 }}>
                            {t('lobby.matchmaking_searching')}
                        </p>
                        {safeMode === 'standard' && (
                            <div className="sk-reward-grid">
                                {t('lobby.matchmaking_coin_rewards').split('\n').flatMap((line, i) => {
                                    const sep = line.indexOf(': ');
                                    return [
                                        <span key={`l${i}`} className="sk-reward-label">{line.slice(0, sep)}:</span>,
                                        <span key={`v${i}`} className="sk-reward-value">{line.slice(sep + 2)}</span>
                                    ];
                                })}
                            </div>
                        )}
                        {error && <p style={{ color: '#dc3545', marginTop: 10 }}>{error}</p>}
                        <div className="sk-row-buttons">
                            <IonButton fill="outline" color="medium" onClick={cancel}>
                                <IonIcon slot="start" icon={closeCircleOutline} />
                                {t('lobby.cancel_button')}
                            </IonButton>
                        </div>
                    </div>
                </div>
            </IonContent>
        </IonPage>
    );
}
