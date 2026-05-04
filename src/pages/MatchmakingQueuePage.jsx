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
import { clampGridSize } from '../utils/sanitize';

function useQuery() {
    return new URLSearchParams(useLocation().search);
}

export default function MatchmakingQueuePage() {
    const { t } = useI18n();
    const { user, loading } = useAuth();
    const history = useHistory();
    const { mode } = useParams();
    const query = useQuery();
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);

    const safeMode = useMemo(
        () => (mode === 'ranked' || mode === 'standard' ? mode : 'standard'),
        [mode]
    );

    const standardGridSize = clampGridSize(query.get('gridSize'));

    useEffect(() => {
        if (!loading && !user) history.replace('/online/auth');
    }, [loading, user, history]);

    useEffect(() => {
        if (!user) return undefined;

        let active = true;
        let trying = false;
        let unsubscribe = () => { };
        let retryTimer = null;
        let heartbeatTimer = null;
        let lastRedirectedGameId = null; // Track to avoid redirecting twice to same game

        const attemptMatch = async () => {
            if (trying) return;
            trying = true;
            try {
                const gameId = await tryFindMatch({ userId: user.uid, mode: safeMode });
                if (active && gameId) {
                    // validate backend that this user is actually a participant in the game
                    const ok = await validateGame({ gameId });
                    if (ok) history.replace(`/online/game/${gameId}`);
                }
            } catch (_) {
                // Keep searching; transient failures should not stop queue retries.
            } finally {
                trying = false;
            }
        };

        const start = async () => {
            try {
                const isRanked = safeMode === 'ranked';
                // Always cancel any previous matchmaking to clear stale queue state.
                // The worker enqueue handler accepts overwrite of stale entries, so no
                // propagation sleep is needed here.
                await cancelMatchmaking(user.uid, safeMode);

                await enqueueForMatch({
                    user,
                    mode: safeMode,
                    gridSize: isRanked ? 8 : standardGridSize,
                    // Online games (both ranked and standard) always run with the timer.
                    timerEnabled: true
                });

                unsubscribe = listenForMatch(user.uid, safeMode, async (queueEntry) => {
                    if (!active || !queueEntry) return;
                    if (queueEntry.status === 'matched' && queueEntry.gameId) {
                        // Avoid redirecting to same game twice (prevents listener from firing on cached state)
                        if (queueEntry.gameId !== lastRedirectedGameId) {
                            lastRedirectedGameId = queueEntry.gameId;
                            // validate before navigating
                            try {
                                const ok = await validateGame({ gameId: queueEntry.gameId });
                                if (ok) history.replace(`/online/game/${queueEntry.gameId}`);
                            } catch (e) {
                                // ignore invalid or transient errors
                            }
                        }
                    }
                });

                await attemptMatch();

                // Re-run matchmaking regularly so ranked range widening over time can take effect.
                retryTimer = window.setInterval(() => {
                    void attemptMatch();
                }, 3000);

                // Heartbeat keeps the queue entry alive so it isn't pruned as stale.
                heartbeatTimer = window.setInterval(() => {
                    if (!active) return;
                    void heartbeatMatchmaking(safeMode).catch(() => { });
                }, 10000);
            } catch (e) {
                if (!active) return;
                // Backend says we're already in an active game — reconnect instead of erroring out.
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
            unsubscribe();
            if (retryTimer) window.clearInterval(retryTimer);
            if (heartbeatTimer) window.clearInterval(heartbeatTimer);
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
