import { useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonAlert
} from '@ionic/react';
import {
  gameControllerOutline,
  enterOutline,
  trophySharp,
  addCircleOutline,
  flashOutline,
  lockClosedOutline
} from 'ionicons/icons';
import AppHeader from '../components/AppHeader';
import CoinBalance from '../components/CoinBalance';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useGameExit } from '../contexts/GameExitContext';
import {
  useEconomy,
  RANKED_ENTRY_COST,
  GRID_UNLOCK_COSTS
} from '../contexts/EconomyContext';
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
  const { coins, isGridUnlocked, purchaseGridUnlock } = useEconomy();
  const history = useHistory();
  const [mode, setMode] = useState(null); // null | 'standard' | 'ranked'
  const [gridSize, setGridSize] = useState(8);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [pendingUnlockSize, setPendingUnlockSize] = useState(null);
  const [unlockBusy, setUnlockBusy] = useState(false);

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

  // If the current grid selection is locked (shouldn't normally happen — 6 is
  // always unlocked, default is 8 — but handles unlock-revocation edge cases),
  // fall back to the smallest unlocked size.
  useEffect(() => {
    if (!isGridUnlocked(gridSize)) {
      const fallback = [6, 8, 10, 12].find((n) => isGridUnlocked(n)) || 6;
      setGridSize(fallback);
    }
  }, [gridSize, isGridUnlocked]);

  const lockedGridSizes = useMemo(
    () => [8, 10, 12].filter((n) => !isGridUnlocked(n)),
    [isGridUnlocked]
  );

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
    const params = mode === 'standard' ? `?gridSize=${gridSize}` : '';
    history.push(`/online/matchmaking/${mode}${params}`);
  };

  const handleUserBarClick = () => {
    setShowEmail(!showEmail);
  };

  const handleConfirmUnlock = async (size) => {
    if (size == null) return;
    setUnlockBusy(true);
    setError('');
    try {
      await purchaseGridUnlock(size);
    } catch (e) {
      const code = e?.data?.code;
      if (code === 'INSUFFICIENT_COINS') {
        setError(t('coins.insufficient'));
      } else {
        setError(e?.message || t('coins.unlock_failed'));
      }
    } finally {
      setUnlockBusy(false);
    }
  };

  const userLabel = showEmail ? user.email : (displayName || user.email);
  const rankedDisabled = coins < RANKED_ENTRY_COST;

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
            <>
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
              <div className="sk-coin-row" title={t('coins.balance_title')}>
                <CoinBalance size="md" />
              </div>
            </>
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
                  {[6, 8, 10, 12]
                    .filter((n) => isGridUnlocked(n))
                    .map((n) => (
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

              {lockedGridSizes.length > 0 && (
                <div className="sk-grid-unlocks">
                  <div className="sk-grid-unlocks-title">{t('coins.unlock_more_title')}</div>
                  {lockedGridSizes.map((size) => {
                    const cost = GRID_UNLOCK_COSTS[size];
                    const canAfford = coins >= cost;
                    return (
                      <div className="sk-grid-unlock-row" key={size}>
                        <span className="sk-grid-unlock-label">{size}×{size}</span>
                        <CoinBalance amount={cost} size="sm" />
                        <IonButton
                          size="small"
                          fill="outline"
                          disabled={!canAfford || unlockBusy}
                          onClick={() => setPendingUnlockSize(size)}
                        >
                          <IonIcon slot="start" icon={lockClosedOutline} />
                          {t('coins.unlock_button')}
                        </IonButton>
                      </div>
                    );
                  })}
                </div>
              )}
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
              <p style={{ textAlign: 'center', marginTop: 6, fontSize: '0.95rem' }}>
                {t('coins.ranked_fee_label')} <CoinBalance amount={RANKED_ENTRY_COST} size="sm" />
              </p>
              {rankedDisabled && (
                <p style={{ textAlign: 'center', color: '#dc3545', marginTop: 4 }}>
                  {t('coins.insufficient_for_ranked')}
                </p>
              )}
              {error && <p style={{ color: '#dc3545', marginTop: 12 }}>{error}</p>}
              <div className="sk-row-buttons">
                <IonButton onClick={handleFindMatch} disabled={rankedDisabled}>
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

        <IonAlert
          isOpen={pendingUnlockSize != null}
          onDidDismiss={() => setPendingUnlockSize(null)}
          header={t('coins.unlock_confirm_title')}
          message={
            pendingUnlockSize != null
              ? t('coins.unlock_confirm_message', {
                  size: `${pendingUnlockSize}×${pendingUnlockSize}`,
                  cost: GRID_UNLOCK_COSTS[pendingUnlockSize],
                  balance: coins
                })
              : ''
          }
          buttons={[
            {
              text: t('lobby.cancel_button'),
              role: 'cancel'
            },
            {
              text: t('coins.unlock_button'),
              handler: () => {
                const size = pendingUnlockSize;
                setPendingUnlockSize(null);
                handleConfirmUnlock(size);
              }
            }
          ]}
        />
      </IonContent>
    </IonPage>
  );
}
