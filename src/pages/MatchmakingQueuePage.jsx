import { useCallback, useEffect, useMemo, useState } from 'react';
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
        // Precise one-shot retry scheduled at joinedAtMs + HUMAN_WAIT_MS_CLIENT
        // + buffer. Saves ~2s on the solo-bot path vs. waiting the generic 5s
        // armTimers retry — without it the second /run only fires after the
        // first 5s setInterval tick, which lands 2-3s past the worker's
        // bot-eligibility threshold.
        let preciseRetryTimer = null;
        let lastRedirectedGameId = null;
        let queueWasPresent = false;
        let reEnqueuing = false;

        const attemptMatch = async () => {
            if (trying) return;
            trying = true;
            try {
                const gameId = await tryFindMatch({ userId: user.uid, mode: safeMode });
                if (active && gameId) {
                    const ok = await validateGame({ gameId });
                    if (ok) history.replace(`/online/game/${gameId}`);
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
                const enqueueAt = Date.now();
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

                await attemptMatch();

                // First /run usually returns null because selfWaitMs is below the
                // worker's HUMAN_WAIT_MS threshold. Schedule a precise one-shot
                // retry at exactly that threshold (plus a small buffer for clock
                // skew) so solo-bot match lands at ~T+3.3s instead of waiting the
                // generic 5s armTimers tick (which would be ~T+7s). Mirrors
                // worker/src/index.js HUMAN_WAIT_MS — keep these in sync.
                const HUMAN_WAIT_MS_CLIENT = 3000;
                const PRECISE_RETRY_BUFFER_MS = 300;
                const elapsedSinceEnqueue = Date.now() - enqueueAt;
                const preciseDelayMs = Math.max(
                    0,
                    HUMAN_WAIT_MS_CLIENT - elapsedSinceEnqueue + PRECISE_RETRY_BUFFER_MS
                );
                preciseRetryTimer = window.setTimeout(() => {
                    preciseRetryTimer = null;
                    if (!active) return;
                    void attemptMatch();
                }, preciseDelayMs);

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
    useEffect(() => {
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
