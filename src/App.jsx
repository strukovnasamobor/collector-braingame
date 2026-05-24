import { useEffect } from 'react';
import { Redirect, Route } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { IonApp, IonRouterOutlet, IonTabs } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';

import { I18nProvider } from './contexts/I18nContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { EconomyProvider } from './contexts/EconomyContext';
import { LocalGameProvider } from './contexts/LocalGameContext';
import { GameExitProvider } from './contexts/GameExitContext';

import TabBar from './components/TabBar';
import BackgroundCanvas from './components/BackgroundCanvas';
import AppSideMenu from './components/AppSideMenu';

import OfflinePage from './pages/OfflinePage';
import OfflineGamePage from './pages/OfflineGamePage';
import OnlinePage from './pages/OnlinePage';
import AuthScreen from './pages/AuthScreen';
import LobbyScreen from './pages/LobbyScreen';
import WaitingRoom from './pages/WaitingRoom';
import JoinRoomForm from './pages/JoinRoomForm';
import MatchmakingQueuePage from './pages/MatchmakingQueuePage';
import OnlineGamePage from './pages/OnlineGamePage';
import LeaderboardPage from './pages/LeaderboardPage';

function RouteFocusReset() {
  const location = useLocation();

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <IonApp>
      <I18nProvider>
        <ThemeProvider>
          <AuthProvider>
            <EconomyProvider>
              <LocalGameProvider>
                <GameExitProvider>
                  <BackgroundCanvas />
                  <IonReactRouter>
                    <RouteFocusReset />
                    <AppSideMenu />
                    <IonTabs>
                      <IonRouterOutlet id="main-content">
                        <Route exact path="/offline" component={OfflinePage} />
                        <Route exact path="/offline/game" component={OfflineGamePage} />
                        <Route exact path="/online" component={OnlinePage} />
                        <Route exact path="/online/auth" component={AuthScreen} />
                        <Route exact path="/online/lobby" component={LobbyScreen} />
                        <Route exact path="/online/waiting/:code" component={WaitingRoom} />
                        <Route exact path="/online/join" component={JoinRoomForm} />
                        <Route
                          exact
                          path="/online/matchmaking/:mode"
                          component={MatchmakingQueuePage}
                        />
                        <Route exact path="/online/game/:id" component={OnlineGamePage} />
                        <Route exact path="/leaderboard" component={LeaderboardPage} />
                        <Route exact path="/">
                          <Redirect to="/online" />
                        </Route>
                      </IonRouterOutlet>
                      <TabBar />
                    </IonTabs>
                  </IonReactRouter>
                </GameExitProvider>
              </LocalGameProvider>
            </EconomyProvider>
          </AuthProvider>
        </ThemeProvider>
      </I18nProvider>
    </IonApp>
  );
}
