import { useEffect, useState, useMemo, useCallback } from 'react';
import { useHistory, useParams } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonAlert,
  IonSpinner
} from '@ionic/react';
import AppHeader from '../components/AppHeader';
import GameBoard from '../components/GameBoard';
import MilestoneCelebration from '../components/MilestoneCelebration';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineGame } from '../hooks/useOnlineGame';
import { useGameTimer } from '../hooks/useGameTimer';
import { useGameExit } from '../contexts/GameExitContext';
import { useGroupMilestones } from '../hooks/useGroupMilestones';
import { formatDelta } from '../game/gameEngine';
import { notifyGameJoin } from '../services/firebaseActions';

export default function OnlineGamePage() {
  const { t } = useI18n();
  const { id } = useParams();
  const { user } = useAuth();
  const history = useHistory();
  const {
    data,
    exists,
    state,
    history: placementHistory,
    serverHistory,
    scores,
    serverScores,
    myPlayerNumber,
    ratings,
    placeDot,
    onTimeout,
    leaveGame,
    turnKey,
    phase,
    lastPlaces,
    currentPlayer,
    localError,
    finalResult
  } = useOnlineGame(id);

  const [alertError, setAlertError] = useState('');
  const [opponentLeftOpen, setOpponentLeftOpen] = useState(false);
  const { registerExit, clearExit } = useGameExit();

  const watchPlayers = useMemo(
    () => (myPlayerNumber ? [myPlayerNumber] : []),
    [myPlayerNumber]
  );
  const { event: milestoneEvent, dismiss: dismissMilestone } = useGroupMilestones({
    scores: serverScores,
    matchKey: id,
    watchPlayers,
    enabled: !!data,
    gridSize: data?.gridSize
  });

  useEffect(() => {
    if (exists === false) history.replace('/online/lobby');
    // If user is not a player in this game, go back to lobby
    if (exists === true && data && myPlayerNumber === null) {
      history.replace('/online/lobby');
    }
  }, [exists, history, data, myPlayerNumber]);

  // Notify backend when player joins the game
  useEffect(() => {
    if (!user || !exists || !id) return;
    const notifyJoin = async () => {
      try {
        await notifyGameJoin({ gameId: id });
      } catch (error) {
        console.error('Failed to notify game join:', error?.code || error?.message || 'unknown');
      }
    };
    notifyJoin();
  }, [user, exists, id]);

  useEffect(() => {
    if (!data) return;
    const opponentLeft =
      data.status === 'left' &&
      data.leftBy &&
      myPlayerNumber != null &&
      data.leftBy !== (myPlayerNumber === 1 ? data.player1uid : data.player2uid);

    if (opponentLeft) {
      const key =
        data.mode === 'ranked'
          ? 'notifications.opponent_left_no_rating_change'
          : 'notifications.opponent_left';
      setAlertError(t(key));
      setOpponentLeftOpen(true);
    }
  }, [data, t, myPlayerNumber]);

  useEffect(() => {
    if (localError) setAlertError(t(localError));
  }, [localError, t]);

  const isMyTurn =
    data?.status === 'active' && currentPlayer === myPlayerNumber;

  const seconds = useGameTimer({
    enabled: !!data && data.status === 'active' && !!data.timerEnabled,
    turnKey,
    onTimeout
  });

  const handleQuit = useCallback(() => {
    // Navigate first so the page unmounts before the Firestore snapshot of the
    // finished/left game can trigger the Game Over alert. The leave request
    // continues in the background; failures don't matter — the cron sweep is the
    // ultimate backstop.
    history.replace('/online/lobby');
    leaveGame().catch(() => {});
  }, [leaveGame, history]);

  useEffect(() => {
    registerExit({
      tabRoot: '/online',
      onConfirm: handleQuit
    });
    return () => clearExit('/online');
  }, [registerExit, clearExit, handleQuit]);

  const message = useMemo(() => {
    if (!finalResult || !data) return '';
    const { winner, score1, score2, timeout, loser, delta1, delta2, newR1, newR2 } =
      finalResult;
    const p1 = data.player1name;
    const p2 = data.player2name;
    const ratingLine =
      delta1 != null && delta2 != null
        ? '\n' +
        t('game.rating_change', {
          p1,
          d1: formatDelta(delta1),
          r1: newR1,
          p2,
          d2: formatDelta(delta2),
          r2: newR2
        })
        : '';
    if (timeout) {
      const loserName = loser === 1 ? p1 : p2;
      const winnerName = winner === 1 ? p1 : p2;
      return (
        t('game.timeout_loss', { player: loserName }) +
        '\n' +
        t('game.game_over_winner', { player: winnerName }) +
        ratingLine
      );
    }
    if (winner === 0) return t('game.game_over_draw') + ratingLine;
    const winnerName = winner === 1 ? p1 : p2;
    return t('game.game_over_winner', { player: winnerName }) + ratingLine;
  }, [finalResult, data, t]);

  if (!data) {
    return (
      <IonPage>
        <AppHeader />
        <IonContent fullscreen>
          <div className="sk-menu-content">
            <IonSpinner />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const currentName =
    currentPlayer === 1 ? data.player1name : data.player2name;
  const statusText =
    phase === 'place'
      ? t('game.phase_place', { player: currentName })
      : t('game.phase_eliminate', { player: currentName });
  const statusColor = currentPlayer === 1 ? '#dc3545' : '#007bff';
  const isRanked = data.mode === 'ranked';

  return (
    <IonPage>
      <AppHeader />
      <IonContent fullscreen scrollY={false} className="sk-game-content">
        <div className="sk-tab-section sk-game-stage ion-padding-horizontal">
          <div className="sk-game-header">
            <div className={`sk-player-info${currentPlayer === 1 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#dc3545' }}>
                {data.player1name}
                {isRanked ? ` (${Math.round(ratings[1])})` : ''}
              </div>
              <div className="sk-player-score">{scores[1]}</div>
            </div>
            <div className={`sk-player-info${currentPlayer === 2 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#007bff' }}>
                {data.player2name || '—'}
                {isRanked ? ` (${Math.round(ratings[2])})` : ''}
              </div>
              <div className="sk-player-score">{scores[2]}</div>
            </div>
          </div>

          <GameBoard
            state={state}
            size={data.gridSize}
            history={placementHistory}
            animationHistory={serverHistory}
            onCellClick={placeDot}
            disabled={!isMyTurn || data.status !== 'active'}
            phase={phase}
            lastPlaces={lastPlaces}
          />

          {data.timerEnabled && data.status === 'active' && (
            <div className={`sk-turn-timer${seconds <= 10 ? ' warning' : ''}`}>
              {seconds}
            </div>
          )}

          <div className="sk-status" style={{ color: statusColor }}>
            {data.status === 'active' ? statusText : ''}
          </div>
        </div>

        <MilestoneCelebration event={milestoneEvent} onDone={dismissMilestone} />

        <IonAlert
          isOpen={!!alertError && !opponentLeftOpen}
          onDidDismiss={() => {
            setAlertError('');
          }}
          header={t('app_title')}
          message={alertError}
          buttons={[t('notifications.ok_button')]}
        />

        <IonAlert
          isOpen={opponentLeftOpen}
          backdropDismiss={false}
          onDidDismiss={() => {
            setOpponentLeftOpen(false);
            setAlertError('');
          }}
          header={t('app_title')}
          message={alertError}
          buttons={[
            {
              text: t('notifications.ok_button'),
              handler: () => {
                history.replace('/online/lobby');
              }
            }
          ]}
        />

        <IonAlert
          cssClass="sk-alert-pre"
          isOpen={!!finalResult}
          backdropDismiss={false}
          header={t('game.game_over_title')}
          message={message}
          buttons={[
            {
              text: t('notifications.ok_button'),
              handler: handleQuit
            }
          ]}
        />
      </IonContent>
    </IonPage>
  );
}
