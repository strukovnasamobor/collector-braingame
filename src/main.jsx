import React from 'react';
import { createRoot } from 'react-dom/client';
import { setupIonicReact } from '@ionic/react';
import App from './App';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

import './theme/variables.css';
import './App.css';
import { registerSW } from 'virtual:pwa-register';

import { Capacitor } from '@capacitor/core';
import { FirebaseAppCheck } from '@capacitor-firebase/app-check';

// Wrapped in an async IIFE because Vite's default browser target doesn't
// allow top-level await. Fire-and-forget — App Check init failing is
// non-fatal, and Firebase Auth requests that need a token will just retry
// once the provider is ready.
if (Capacitor.isNativePlatform()) {
  // Marker class scoped to native: CSS can target html.capacitor-native to
  // disable safe-area insets, force fullscreen layout, etc. — without
  // affecting the web/browser PWA where those insets still matter.
  document.documentElement.classList.add('capacitor-native');

  (async () => {
    try {
      await FirebaseAppCheck.initialize({
        provider: 'playIntegrity',
        isTokenAutoRefreshEnabled: true
      });
    } catch (e) {
      console.warn('AppCheck init failed:', e?.message || e);
    }
  })();
}

setupIonicReact({ mode: 'md' });

// Registers and keeps the PWA service worker up to date in production.
registerSW({
  immediate: true
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
