import { useEffect, useMemo, useState, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton
} from '@ionic/react';
import AppHeader from '../components/AppHeader';
import GameBoard from '../components/GameBoard';
import MilestoneCelebration from '../components/MilestoneCelebration';
import TimesUpFlash from '../components/TimesUpFlash';
import { useI18n } from '../contexts/I18nContext';
import { useLocalGame } from '../contexts/LocalGameContext';
import { useGameTimer } from '../hooks/useGameTimer';
import { useGameExit } from '../contexts/GameExitContext';
import { useGroupMilestones } from '../hooks/useGroupMilestones';

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
    isActive,
    isAITurn,
    matchId
  } = useLocalGame();

  const { registerExit, clearExit } = useGameExit();

  const humanPlayers = useMemo(() => {
    if (!config) return [];
    const list = [];
    if (!config.player1AI) list.push(1);
    if (!config.player2AI) list.push(2);
    return list;
  }, [config]);

  const { event: milestoneEvent, dismiss: dismissMilestone } = useGroupMilestones({
    scores,
    matchKey: matchId,
    watchPlayers: humanPlayers,
    enabled: !!config,
    gridSize: config?.gridSize
  });

  useEffect(() => {
    if (!config) history.replace('/offline');
  }, [config, history]);

  useEffect(() => {
    registerExit({
      tabRoot: '/offline',
      silent: !!result,
      onConfirm: () => {
        clearGame();
        history.replace('/offline');
      }
    });
    return () => clearExit('/offline');
  }, [registerExit, clearExit, clearGame, history, result]);

  const seconds = useGameTimer({
    enabled: !!config && !!config.timerEnabled && isActive,
    turnKey,
    onTimeout
  });

  // Pulse the turn-status text when the player taps the board while it isn't
  // theirs (e.g., AI thinking) — keyed so React remounts and the CSS animation
  // restarts on each tap.
  const [statusPulseKey, setStatusPulseKey] = useState(0);
  const handleDisabledClick = useCallback(() => {
    if (!isActive) return;
    setStatusPulseKey((k) => k + 1);
  }, [isActive]);

  if (!config) return null;

  const name = currentPlayer === 1 ? config.player1Name : config.player2Name;
  const statusText = isAITurn
    ? t('game.ai_thinking', { player: name })
    : phase === 'place'
      ? t('game.phase_place', { player: name })
      : t('game.phase_eliminate', { player: name });
  const statusColor = currentPlayer === 1 ? '#dc3545' : '#007bff';

  const renderWinnerLine = (winnerName, winnerNumber) => {
    const winnerColor = winnerNumber === 1 ? '#dc3545' : '#007bff';
    // Whole "{name} wins!" string pulses in the winner's color.
    return (
      <span className="sk-winner-name" style={{ color: winnerColor }}>
        {t('game.game_over_winner', { player: winnerName })}
      </span>
    );
  };

  const buildGameOverMessage = () => {
    if (!result) return null;
    const { winner, timeout, loser } = result;
    const p1 = config.player1Name;
    const p2 = config.player2Name;
    if (timeout) {
      const loserName = loser === 1 ? p1 : p2;
      const winnerName = winner === 1 ? p1 : p2;
      return (
        <>
          {t('game.timeout_loss', { player: loserName })}
          {'\n'}
          {renderWinnerLine(winnerName, winner)}
        </>
      );
    }
    if (winner === 0) return t('game.game_over_draw');
    const winnerName = winner === 1 ? p1 : p2;
    return renderWinnerLine(winnerName, winner);
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
            onDisabledClick={handleDisabledClick}
            disabled={!isActive || isAITurn}
            phase={phase}
            lastPlaces={lastPlaces}
          />

          {config.timerEnabled && isActive && (
            <div
              className={`sk-turn-timer${seconds <= 10 ? ' warning' : ''}`}
              style={seconds <= 10 ? { color: currentPlayer === 1 ? '#dc3545' : '#007bff' } : undefined}
            >
              {seconds}
            </div>
          )}

          {result ? (
            <div
              className="sk-status sk-status--game-over"
              style={{ whiteSpace: 'pre-line' }}
            >
              <div className="sk-game-over-title">{t('game.game_over_title')}</div>
              <div className="sk-game-over-message">{buildGameOverMessage()}</div>
              <div className="sk-game-over-actions">
                <IonButton size="small" onClick={resetGame}>
                  {t('game.new_game_button')}
                </IonButton>
                <IonButton
                  size="small"
                  fill="outline"
                  onClick={() => {
                    clearGame();
                    history.replace('/offline');
                  }}
                >
                  {t('game.main_menu_button')}
                </IonButton>
              </div>
            </div>
          ) : (
            <div
              key={`status-${statusPulseKey}`}
              className={`sk-status${statusPulseKey > 0 ? ' sk-status--pulse' : ''}`}
              style={{ color: statusColor }}
            >
              {isActive ? statusText : ''}
            </div>
          )}
        </div>

        <MilestoneCelebration event={milestoneEvent} onDone={dismissMilestone} />
        <TimesUpFlash
          seconds={seconds}
          currentPlayer={currentPlayer}
          active={!!config && !!config.timerEnabled && isActive}
        />
      </IonContent>
    </IonPage>
  );
}
