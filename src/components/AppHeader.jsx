import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonAlert,
  IonMenuToggle
} from '@ionic/react';
import {
  helpCircleOutline,
  moonOutline,
  sunnyOutline,
  menuOutline
} from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useEconomy } from '../contexts/EconomyContext';
import useAnimatedCounter from '../hooks/useAnimatedCounter';
import CoinBalance from './CoinBalance';
import RulesModal from './RulesModal';

export default function AppHeader({ title }) {
  const { t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { coins } = useEconomy();
  const location = useLocation();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  // While a CoinReward animation is in flight, hold the wallet at its
  // pre-reward value. CoinReward dispatches 'coin-reward-lock' on mount and
  // 'coin-reward-unlock' the moment the coins land.
  const [pendingDelta, setPendingDelta] = useState(0);
  useEffect(() => {
    const onLock = (e) => setPendingDelta(Number(e.detail?.delta) || 0);
    const onUnlock = () => setPendingDelta(0);
    window.addEventListener('coin-reward-lock', onLock);
    window.addEventListener('coin-reward-unlock', onUnlock);
    return () => {
      window.removeEventListener('coin-reward-lock', onLock);
      window.removeEventListener('coin-reward-unlock', onUnlock);
    };
  }, []);
  const targetCoins = Math.max(0, coins - pendingDelta);
  const displayCoins = useAnimatedCounter(targetCoins);

  let derivedTitle = t('app_title');
  if (location.pathname.startsWith('/online')) {
    derivedTitle = t('tabs.online');
  } else if (location.pathname.startsWith('/offline')) {
    derivedTitle = t('tabs.offline');
  }

  useEffect(() => {
    const handler = () => setRulesOpen(false);
    window.addEventListener('auth-changed', handler);
    return () => window.removeEventListener('auth-changed', handler);
  }, []);

  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            <span className="sk-header-title">{title || derivedTitle}</span>
          </IonTitle>
          <IonButtons slot="end">
            {user && (
              <IonButton
                onClick={() => setWalletOpen(true)}
                aria-label={t('coins.wallet_alert_header')}
                className="sk-header-wallet-btn"
              >
                <CoinBalance amount={displayCoins} size="sm" className="sk-header-coins" />
              </IonButton>
            )}
            <IonButton
              onClick={toggleTheme}
              title={isDark ? t('menu.theme_light') : t('menu.theme_dark')}
              aria-label="Toggle theme"
            >
              <IonIcon slot="icon-only" icon={isDark ? moonOutline : sunnyOutline} />
            </IonButton>
            <IonButton
              onClick={() => setRulesOpen(true)}
              title={t('rules.title')}
              aria-label="Rules"
            >
              <IonIcon slot="icon-only" icon={helpCircleOutline} />
            </IonButton>
            <IonMenuToggle menu="app-menu" autoHide={false}>
              <IonButton title={t('header.dropdown')} aria-label="Menu">
                <IonIcon slot="icon-only" icon={menuOutline} />
              </IonButton>
            </IonMenuToggle>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <IonAlert
        isOpen={walletOpen}
        onDidDismiss={() => setWalletOpen(false)}
        header={t('coins.wallet_alert_header')}
        message={t('coins.wallet_alert_message', { amount: coins.toLocaleString() })}
        cssClass="sk-wallet-alert"
        buttons={[t('notifications.ok_button')]}
      />
    </>
  );
}
