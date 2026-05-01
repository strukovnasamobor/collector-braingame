import { useState } from 'react';
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonCheckbox,
  IonIcon
} from '@ionic/react';
import { closeOutline, playOutline } from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';
import { sanitizeDisplayName, DISPLAY_NAME_MAX } from '../utils/sanitize';
import { TIER_ORDER } from '../game/aiTiers';

export default function NameDialog({ open, onCancel, onStart }) {
  const { t } = useI18n();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [size, setSize] = useState(8);
  const [timer, setTimer] = useState(true);
  const [p1AI, setP1AI] = useState(false);
  const [p1Algo, setP1Algo] = useState('medium');
  const [p2AI, setP2AI] = useState(false);
  const [p2Algo, setP2Algo] = useState('medium');
  const [error, setError] = useState('');

  const aiPlayerName = (algo) =>
    t('game.ai_player_name', { tier: t(`game.ai_tier_${algo}`) });

  const handleStart = () => {
    const p1t = p1AI
      ? aiPlayerName(p1Algo)
      : sanitizeDisplayName(p1) || 'Player 1';
    const p2t = p2AI
      ? aiPlayerName(p2Algo)
      : sanitizeDisplayName(p2) || 'Player 2';
    setError('');
    onStart({
      player1Name: p1t,
      player2Name: p2t,
      gridSize: size,
      timerEnabled: timer,
      player1AI: p1AI ? p1Algo : null,
      player2AI: p2AI ? p2Algo : null
    });
  };

  return (
    <IonModal isOpen={open} onDidDismiss={onCancel}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('game.new_game_dialog')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onCancel} aria-label="Close">
              <IonIcon slot="icon-only" icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonLabel position="stacked">{t('game.player1_name')}</IonLabel>
          {p1AI ? (
            <IonSelect value={p1Algo} onIonChange={(e) => setP1Algo(e.detail.value)}>
              {TIER_ORDER.map((tier) => (
                <IonSelectOption key={tier} value={tier}>
                  {t(`game.ai_tier_${tier}`)}
                </IonSelectOption>
              ))}
            </IonSelect>
          ) : (
            <IonInput
              value={p1}
              placeholder={t('game.player1_placeholder')}
              maxlength={DISPLAY_NAME_MAX}
              onIonInput={(e) => setP1(e.detail.value || '')}
            />
          )}
          <IonCheckbox
            slot="end"
            checked={p1AI}
            labelPlacement="start"
            onIonChange={(e) => setP1AI(e.detail.checked)}
          >
            {t('game.ai_label')}
          </IonCheckbox>
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">{t('game.player2_name')}</IonLabel>
          {p2AI ? (
            <IonSelect value={p2Algo} onIonChange={(e) => setP2Algo(e.detail.value)}>
              {TIER_ORDER.map((tier) => (
                <IonSelectOption key={tier} value={tier}>
                  {t(`game.ai_tier_${tier}`)}
                </IonSelectOption>
              ))}
            </IonSelect>
          ) : (
            <IonInput
              value={p2}
              placeholder={t('game.player2_placeholder')}
              maxlength={DISPLAY_NAME_MAX}
              onIonInput={(e) => setP2(e.detail.value || '')}
            />
          )}
          <IonCheckbox
            slot="end"
            checked={p2AI}
            labelPlacement="start"
            onIonChange={(e) => setP2AI(e.detail.checked)}
          >
            {t('game.ai_label')}
          </IonCheckbox>
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">{t('game.grid_size_label')}</IonLabel>
          <IonSelect value={size} onIonChange={(e) => setSize(Number(e.detail.value))}>
            {[6, 8, 10, 12].map((n) => (
              <IonSelectOption key={n} value={n}>
                {n}×{n}
              </IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
        <IonItem>
          <IonCheckbox
            checked={timer}
            onIonChange={(e) => setTimer(e.detail.checked)}
            slot="start"
          />
          <IonLabel>{t('game.timer_label')}</IonLabel>
        </IonItem>
        {error && (
          <p style={{ color: '#dc3545', margin: '12px 0 0 16px' }}>{error}</p>
        )}
        <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <IonButton onClick={handleStart} color="primary">
            <IonIcon slot="start" icon={playOutline} />
            {t('game.start_button')}
          </IonButton>
          <IonButton onClick={onCancel} fill="outline">
            {t('game.cancel_button')}
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
}
