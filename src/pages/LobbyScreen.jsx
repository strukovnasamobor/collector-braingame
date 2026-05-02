import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption
} from '@ionic/react';
import {
  gameControllerOutline,
  enterOutline,
  trophySharp,
  addCircleOutline,
  flashOutline
} from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useGameExit } from '../contexts/GameExitContext';
import { createStandardRoom } from '../services/firebaseActions';

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function LobbyScreen() {
  const { t } = useI18n();
  const { user, loading, displayName } = useAuth();
  const history = useHistory();
  const [mode, setMode] = useState(null); // null | 'standard' | 'ranked'
  const [gridSize, setGridSize] = useState(8);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    if (!loading && !user) history.replace('/online/auth');
  }, [user, loading, history]);

  const { registerExit, clearExit } = useGameExit();
  useEffect(() => {
    if (!mode) return undefined;
    registerExit({
      tabRoot: '/online',
      silent: true,
      onConfirm: () => setMode(null)
    });
    return () => clearExit('/online');
  }, [mode, registerExit, clearExit]);

  if (!user) return null;

  const handleCreateStandardRoom = async () => {
    const size = gridSize;
    const code = generateGameCode();

    setCreating(true);
    setError('');
    try {
      // Online games always have the per-turn timer.
      await createStandardRoom({ code, gridSize: size, timerEnabled: true });
      history.push(`/online/waiting/${code}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleFindMatch = () => {
    // Online matches always have the per-turn timer; only board size needs
    // to be carried over for standard matchmaking.
    const params = mode === 'standard' ? `?gridSize=${gridSize}` : '';
    history.push(`/online/matchmaking/${mode}${params}`);
  };

  const handleUserBarClick = () => {
    setShowEmail(!showEmail);
  };

  const userLabel = showEmail ? user.email : (displayName || user.email);

  return (
    <IonPage>
      <AppHeader />
      <IonContent fullscreen>
        <div className="sk-menu-content">
          <div
            className="sk-user-bar"
            title={user.email}
            onClick={handleUserBarClick}
          >
            {userLabel}
          </div>

          {!mode && (
            <div className="sk-menu-buttons">
              <IonButton
                className="sk-menu-btn"
                expand="block"
                onClick={() => setMode('standard')}
              >
                <IonIcon slot="start" icon={gameControllerOutline} />
                {t('lobby.create_standard')}
              </IonButton>
              <IonButton
                className="sk-menu-btn"
                expand="block"
                onClick={() => setMode('ranked')}
              >
                <IonIcon slot="start" icon={trophySharp} />
                {t('lobby.create_ranked')}
              </IonButton>
            </div>
          )}

          {mode === 'standard' && (
            <div className="sk-lobby-panel">
              <div style={{ fontWeight: 700, marginBottom: 10, textAlign: 'center' }}>
                {t('lobby.standard_mode')}
              </div>
              <IonItem>
                <IonLabel position="stacked">{t('lobby.grid_size')}</IonLabel>
                <IonSelect
                  value={gridSize}
                  onIonChange={(e) => setGridSize(Number(e.detail.value))}
                >
                  {[6, 8, 10, 12].map((n) => (
                    <IonSelectOption key={n} value={n}>
                      {n}×{n}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
              {error && (
                <p style={{ color: '#dc3545', marginTop: 12 }}>{error}</p>
              )}
              <div className="sk-row-buttons">
                <IonButton disabled={creating} onClick={handleCreateStandardRoom}>
                  <IonIcon slot="start" icon={addCircleOutline} />
                  {t('lobby.create_button')}
                </IonButton>
                <IonButton onClick={handleFindMatch}>
                  <IonIcon slot="start" icon={flashOutline} />
                  {t('lobby.find_match')}
                </IonButton>
              </div>
              <div className="sk-row-buttons">
                <IonButton fill="outline" onClick={() => history.push('/online/join')}>
                  <IonIcon slot="start" icon={enterOutline} />
                  {t('lobby.join_game')}
                </IonButton>
                <IonButton fill="outline" onClick={() => setMode(null)}>
                  {t('lobby.cancel_button')}
                </IonButton>
              </div>
            </div>
          )}

          {mode === 'ranked' && (
            <div className="sk-lobby-panel">
              <div style={{ fontWeight: 700, marginBottom: 10, textAlign: 'center', whiteSpace: 'pre-line' }}>
                {t('lobby.ranked_mode')}
              </div>
              <p style={{ textAlign: 'center', marginTop: 0 }}>
                {t('lobby.ranked_matchmaking_only')}
              </p>
              {error && <p style={{ color: '#dc3545', marginTop: 12 }}>{error}</p>}
              <div className="sk-row-buttons">
                <IonButton onClick={handleFindMatch}>
                  <IonIcon slot="start" icon={flashOutline} />
                  {t('lobby.find_match')}
                </IonButton>
                <IonButton fill="outline" onClick={() => setMode(null)}>
                  {t('lobby.cancel_button')}
                </IonButton>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
