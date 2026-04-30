import { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonAlert
} from '@ionic/react';
import AppHeader from '../components/AppHeader';
import GameBoard from '../components/GameBoard';
import { useI18n } from '../contexts/I18nContext';
import { useLocalGame } from '../contexts/LocalGameContext';
import { useGameTimer } from '../hooks/useGameTimer';
import { useGameExit } from '../contexts/GameExitContext';

export default function OfflineGamePage() {
  const { t } = useI18n();
  const history = useHistory();
  const {
    config,
    state,
    currentPlayer,
    phase,
    lastPlaces,
    history: placementHistory,
    scores,
    result,
    turnKey,
    placeDot,
    clearGame,
    resetGame,
    onTimeout,
    isActive
  } = useLocalGame();

  const { registerExit, clearExit } = useGameExit();

  useEffect(() => {
    if (!config) history.replace('/offline');
  }, [config, history]);

  useEffect(() => {
    registerExit({
      tabRoot: '/offline',
      onConfirm: () => {
        clearGame();
        history.replace('/offline');
      }
    });
    return () => clearExit('/offline');
  }, [registerExit, clearExit, clearGame, history]);

  const seconds = useGameTimer({
    enabled: !!config && !!config.timerEnabled && isActive,
    turnKey,
    onTimeout
  });

  if (!config) return null;

  const name = currentPlayer === 1 ? config.player1Name : config.player2Name;
  const statusText =
    phase === 'place'
      ? t('game.phase_place', { player: name })
      : t('game.phase_eliminate', { player: name });
  const statusColor = currentPlayer === 1 ? '#dc3545' : '#007bff';

  const buildGameOverMessage = () => {
    if (!result) return '';
    const { winner, timeout, loser } = result;
    const { p1 } = { p1: config.player1Name };
    const p2 = config.player2Name;
    if (timeout) {
      const loserName = loser === 1 ? p1 : p2;
      const winnerName = winner === 1 ? p1 : p2;
      return (
        t('game.timeout_loss', { player: loserName }) +
        '\n' +
        t('game.game_over_winner', { player: winnerName })
      );
    }
    if (winner === 0) return t('game.game_over_draw');
    const winnerName = winner === 1 ? p1 : p2;
    return t('game.game_over_winner', { player: winnerName });
  };

  return (
    <IonPage>
      <AppHeader />
      <IonContent fullscreen scrollY={false} className="sk-game-content">
        <div className="sk-tab-section sk-game-stage ion-padding-horizontal">
          <div className="sk-game-header">
            <div className={`sk-player-info${currentPlayer === 1 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#dc3545' }}>
                {config.player1Name}
              </div>
              <div className="sk-player-score">{scores[1]}</div>
            </div>
            <div className={`sk-player-info${currentPlayer === 2 ? ' active' : ''}`}>
              <div className="sk-player-name" style={{ color: '#007bff' }}>
                {config.player2Name}
              </div>
              <div className="sk-player-score">{scores[2]}</div>
            </div>
          </div>

          <GameBoard
            state={state}
            size={config.gridSize}
            history={placementHistory}
            onCellClick={placeDot}
            disabled={!isActive}
            phase={phase}
            lastPlaces={lastPlaces}
          />

          {config.timerEnabled && isActive && (
            <div className={`sk-turn-timer${seconds <= 10 ? ' warning' : ''}`}>{seconds}</div>
          )}

          <div className="sk-status" style={{ color: statusColor }}>
            {isActive ? statusText : ''}
          </div>
        </div>

        <IonAlert
          cssClass="sk-alert-pre"
          isOpen={!!result}
          backdropDismiss={false}
          header={t('game.game_over_title')}
          message={buildGameOverMessage()}
          buttons={[
            {
              text: t('game.new_game_button'),
              handler: () => {
                resetGame();
              }
            },
            {
              text: t('notifications.ok_button'),
              role: 'cancel',
              handler: () => {
                clearGame();
                history.replace('/offline');
              }
            }
          ]}
        />
      </IonContent>
    </IonPage>
  );
}
