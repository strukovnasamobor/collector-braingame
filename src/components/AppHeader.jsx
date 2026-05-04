import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
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
import RulesModal from './RulesModal';

export default function AppHeader({ title }) {
  const { t } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const [rulesOpen, setRulesOpen] = useState(false);

  let derivedTitle = t('app_title');
  if (location.pathname.startsWith('/online')) {
    derivedTitle = t('tabs.online');
  } else if (location.pathname.startsWith('/offline')) {
    derivedTitle = t('tabs.offline');
  }

  // Close rules modal when auth state changes (prevents leftover overlays after redirect signin)
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
    </>
  );
}
