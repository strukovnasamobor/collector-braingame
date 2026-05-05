import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonMenu,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonAlert,
  IonMenuToggle
} from '@ionic/react';
import {
  languageOutline,
  pencilOutline,
  trashOutline,
  logOutOutline,
  logoGithub
} from 'ionicons/icons';
import { useI18n } from '../contexts/I18nContext';
import { useAuth } from '../contexts/AuthContext';

const SOURCE_CODE_URL = 'https://github.com/strukovnasamobor/collector-braingame';

export default function AppSideMenu() {
  const { t, lang, setLang } = useI18n();
  const { user, signOut, displayName, updateDisplayName, deleteAccount } = useAuth();
  const history = useHistory();
  const [langOpen, setLangOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleLanguagePicked = (data) => {
    if (data && data !== lang) setLang(data);
    setLangOpen(false);
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

  const handleSignOut = async () => {
    try { await signOut(); } catch (_) {}
    history.push('/online');
  };

  const handleDeleteConfirmed = async () => {
    try { await deleteAccount(); } catch (_) {}
    setDeleteOpen(false);
    history.push('/online');
  };

  const handleSourceCode = () => {
    window.open(SOURCE_CODE_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <IonMenu menuId="app-menu" contentId="main-content" side="end">
        <IonHeader>
          <IonToolbar>
            <IonTitle>{t('header.dropdown')}</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <IonList lines="none" style={{ flex: 1 }}>
              <IonMenuToggle autoHide={false}>
                <IonItem button detail={false} onClick={() => setLangOpen(true)}>
                  <IonIcon slot="start" icon={languageOutline} />
                  <IonLabel>{t('menu.change_language')}</IonLabel>
                </IonItem>
                {user && (
                  <>
                    <IonItem
                      button
                      detail={false}
                      onClick={() => { setRenameError(''); setRenameOpen(true); }}
                    >
                      <IonIcon slot="start" icon={pencilOutline} />
                      <IonLabel>{t('menu.change_name')}</IonLabel>
                    </IonItem>
                    <IonItem button detail={false} onClick={() => setDeleteOpen(true)}>
                      <IonIcon slot="start" icon={trashOutline} />
                      <IonLabel>{t('menu.delete_account')}</IonLabel>
                    </IonItem>
                    <IonItem button detail={false} onClick={handleSignOut}>
                      <IonIcon slot="start" icon={logOutOutline} />
                      <IonLabel>{t('header.sign_out')}</IonLabel>
                    </IonItem>
                  </>
                )}
              </IonMenuToggle>
            </IonList>
            <IonList lines="none">
              <IonMenuToggle autoHide={false}>
                <IonItem button detail={false} onClick={handleSourceCode}>
                  <IonIcon slot="start" icon={logoGithub} />
                  <IonLabel>{t('menu.source_code')}</IonLabel>
                </IonItem>
              </IonMenuToggle>
            </IonList>
          </div>
        </IonContent>
      </IonMenu>

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
    </>
  );
}
