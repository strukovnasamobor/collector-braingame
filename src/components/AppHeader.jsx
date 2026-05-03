import { useState, useEffect } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonPopover,
  IonList,
  IonItem,
  IonLabel,
  IonAlert
} from '@ionic/react';
import {
  helpCircleOutline,
  languageOutline,
  moonOutline,
  sunnyOutline,
  menuOutline,
  pencilOutline,
  trashOutline,
  logOutOutline,
  logoGithub
} from 'ionicons/icons';

const SOURCE_CODE_URL = 'https://github.com/strukovnasamobor/collector-braingame';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import RulesModal from './RulesModal';

export default function AppHeader({ title }) {
  const { t, lang, setLang } = useI18n();
  const { isDark, toggleTheme } = useTheme();
  const { user, signOut, displayName, updateDisplayName, deleteAccount } = useAuth();
  const location = useLocation();
  const history = useHistory();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuEvent, setMenuEvent] = useState(undefined);
  const [langOpen, setLangOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const openMenu = (e) => {
    setMenuEvent(e.nativeEvent);
    setMenuOpen(true);
  };
  const closeMenu = () => setMenuOpen(false);

  const handleLanguageClick = () => {
    closeMenu();
    setLangOpen(true);
  };

  const handleLanguagePicked = (data) => {
    if (data && data !== lang) setLang(data);
    setLangOpen(false);
  };

  const handleRenameClick = () => {
    closeMenu();
    setRenameError('');
    setRenameOpen(true);
  };

  const handleDeleteClick = () => {
    closeMenu();
    setDeleteOpen(true);
  };

  const handleSourceCodeClick = () => {
    closeMenu();
    window.open(SOURCE_CODE_URL, '_blank', 'noopener,noreferrer');
  };

  const handleSignOutClick = async () => {
    closeMenu();
    try {
      await signOut();
    } catch (_) {}
    history.push('/online');
  };

  const handleRenameSave = async (data) => {
    setRenameError('');
    try {
      await updateDisplayName(data?.displayName);
      setRenameOpen(false);
    } catch (e) {
      setRenameError(e?.message || 'Update failed');
      return false;
    }
  };

  const handleDeleteConfirmed = async () => {
    try {
      await deleteAccount();
    } catch (_) {}
    setDeleteOpen(false);
    history.push('/online');
  };

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
            <IonButton
              onClick={openMenu}
              title={t('header.dropdown')}
              aria-label="Menu"
            >
              <IonIcon slot="icon-only" icon={menuOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonPopover
        isOpen={menuOpen}
        event={menuEvent}
        onDidDismiss={closeMenu}
        dismissOnSelect={true}
      >
        <IonList lines="none">
          <IonItem button detail={false} onClick={handleLanguageClick}>
            <IonIcon slot="start" icon={languageOutline} />
            <IonLabel>{t('menu.change_language')}</IonLabel>
          </IonItem>
          <IonItem button detail={false} onClick={handleSourceCodeClick}>
            <IonIcon slot="start" icon={logoGithub} />
            <IonLabel>{t('menu.source_code')}</IonLabel>
          </IonItem>
          {user && (
            <>
              <IonItem button detail={false} onClick={handleRenameClick}>
                <IonIcon slot="start" icon={pencilOutline} />
                <IonLabel>{t('menu.change_name')}</IonLabel>
              </IonItem>
              <IonItem button detail={false} onClick={handleDeleteClick}>
                <IonIcon slot="start" icon={trashOutline} />
                <IonLabel>{t('menu.delete_account')}</IonLabel>
              </IonItem>
              <IonItem button detail={false} onClick={handleSignOutClick}>
                <IonIcon slot="start" icon={logOutOutline} />
                <IonLabel>{t('header.sign_out')}</IonLabel>
              </IonItem>
            </>
          )}
        </IonList>
      </IonPopover>

      <IonAlert
        isOpen={langOpen}
        header={t('menu.change_language')}
        inputs={[
          { name: 'lang', type: 'radio', label: t('menu.language_en'), value: 'en', checked: lang === 'en' },
          { name: 'lang', type: 'radio', label: t('menu.language_hr'), value: 'hr', checked: lang === 'hr' }
        ]}
        buttons={[
          { text: t('lobby.cancel_button'), role: 'cancel' },
          { text: t('lobby.save_button'), handler: handleLanguagePicked }
        ]}
        onDidDismiss={() => setLangOpen(false)}
      />

      <IonAlert
        isOpen={renameOpen}
        header={t('lobby.rename_title')}
        message={renameError || undefined}
        inputs={[
          {
            name: 'displayName',
            type: 'text',
            value: displayName || '',
            placeholder: t('lobby.rename_placeholder'),
            attributes: { maxlength: 32 }
          }
        ]}
        buttons={[
          { text: t('lobby.cancel_button'), role: 'cancel' },
          { text: t('lobby.save_button'), handler: handleRenameSave }
        ]}
        onDidDismiss={() => { setRenameOpen(false); setRenameError(''); }}
      />

      <IonAlert
        isOpen={deleteOpen}
        header={t('lobby.delete_account_title')}
        message={t('lobby.delete_account_message')}
        cssClass="sk-alert-delete"
        buttons={[
          { text: t('lobby.cancel_button'), role: 'cancel' },
          { text: t('lobby.delete_button'), role: 'destructive', cssClass: 'sk-alert-delete-btn', handler: handleDeleteConfirmed }
        ]}
        onDidDismiss={() => setDeleteOpen(false)}
      />

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </>
  );
}
