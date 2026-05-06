import { useEffect, useState } from 'react';
import { IonTabBar, IonTabButton, IonIcon, IonLabel, IonAlert } from '@ionic/react';
import { gameControllerOutline, globeOutline, trophyOutline } from 'ionicons/icons';
import { useHistory, useLocation } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { useGameExit } from '../contexts/GameExitContext';
import { useLocalGame } from '../contexts/LocalGameContext';

// "Main menu" — the URL we send users to when they tap an active tab from a
// secondary page (auth, waiting room, join form…) that has no exit handler.
const TAB_MAIN_MENU = {
  '/offline': '/offline',
  '/online': '/online/lobby',
  '/leaderboard': '/leaderboard'
};

export default function TabBar() {
  const { t } = useI18n();
  const location = useLocation();
  const history = useHistory();
  const { configs: exitConfigs } = useGameExit();
  const { config: localGameConfig } = useLocalGame();
  const [pendingExit, setPendingExit] = useState(null);
  const [lastOnlineUrl, setLastOnlineUrl] = useState('/online');

  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/online/game/') || path.startsWith('/online/matchmaking/')) {
      setLastOnlineUrl(path + (location.search || ''));
    } else if (path === '/online' || path === '/online/lobby') {
      setLastOnlineUrl('/online');
    }
  }, [location.pathname, location.search]);

  const isOnTab = (tabRoot) => {
    return location.pathname === tabRoot || location.pathname.startsWith(`${tabRoot}/`);
  };

  const offlineTarget = localGameConfig ? '/offline/game' : '/offline';
  const onlineTarget = lastOnlineUrl;

  // Routes that represent active engagement (mid-game, in matchmaking queue) and
  // must always confirm before navigating away — even if the page hasn't yet had a
  // chance to register its exit config (initial-mount race, transient unmount, etc).
  // Without this, a tab tap during the registration window silently navigates the
  // user out of their game with no warning.
  const ACTIVE_ENGAGEMENT_PREFIXES = ['/online/game/', '/online/matchmaking/'];
  const isActiveEngagementRoute = (pathname) =>
    ACTIVE_ENGAGEMENT_PREFIXES.some((p) => pathname.startsWith(p));

  const handleTabClick = (e, tabRoot) => {
    if (!isOnTab(tabRoot)) return; // different tab — let normal routing happen
    e.preventDefault();
    e.stopPropagation();
    const cfg = exitConfigs[tabRoot];
    if (cfg) {
      if (cfg.silent) {
        // Soft "back to main menu" reset — no confirm needed.
        if (cfg.onConfirm) cfg.onConfirm();
        return;
      }
      // Active game / matchmaking on this tab — confirm before leaving.
      setPendingExit(cfg);
      return;
    }
    const mainMenu = TAB_MAIN_MENU[tabRoot];
    if (mainMenu && isActiveEngagementRoute(location.pathname)) {
      // Defensive default: no exit config registered but the URL says we're
      // mid-game / mid-matchmaking. Show the default quit alert instead of
      // silently navigating — the page's own registerExit will replace this
      // with the customised title/message on the next render.
      setPendingExit({
        tabRoot,
        onConfirm: () => history.replace(mainMenu)
      });
      return;
    }
    if (mainMenu && location.pathname !== mainMenu) {
      // Secondary page on this tab — go back to its main menu.
      history.replace(mainMenu);
    }
  };

  const tabButtonProps = (tabRoot, target) => {
    const cfg = exitConfigs[tabRoot];
    const blockedHard = cfg && !cfg.silent && isOnTab(tabRoot);
    return {
      onClick: (e) => handleTabClick(e, tabRoot),
      // When a hard-blocking exit handler is registered, point href at the
      // current pathname so any fallthrough navigation is a no-op (avoids
      // Ionic synthesising a "/tab/undefined" URL).
      href: blockedHard ? location.pathname : target
    };
  };

  const alertOpen = !!pendingExit;
  const alertTitle = pendingExit?.title || t('game.quit_game_title');
  const alertMessage = pendingExit?.message || t('game.quit_game_message');

  return (
    <>
      <IonTabBar slot="bottom">
        <IonTabButton tab="offline" {...tabButtonProps('/offline', offlineTarget)}>
          <IonIcon icon={gameControllerOutline} />
          <IonLabel>{t('tabs.offline')}</IonLabel>
        </IonTabButton>
        <IonTabButton tab="online" {...tabButtonProps('/online', onlineTarget)}>
          <IonIcon icon={globeOutline} />
          <IonLabel>{t('tabs.online')}</IonLabel>
        </IonTabButton>
        <IonTabButton tab="leaderboard" {...tabButtonProps('/leaderboard', '/leaderboard')}>
          <IonIcon icon={trophyOutline} />
          <IonLabel>{t('tabs.leaderboard')}</IonLabel>
        </IonTabButton>
      </IonTabBar>
      <IonAlert
        isOpen={alertOpen}
        onDidDismiss={() => setPendingExit(null)}
        header={alertTitle}
        message={alertMessage}
        buttons={[
          { text: t('game.no_button'), role: 'cancel' },
          {
            text: t('game.yes_button'),
            handler: () => {
              if (pendingExit && pendingExit.onConfirm) {
                pendingExit.onConfirm();
              }
            }
          }
        ]}
      />
    </>
  );
}
