package hr.strukovnasamobor.collector_braingame;

import android.os.Bundle;
import android.webkit.WebSettings;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Disable Android WebView's force-dark inversion so our own theme
        // toggle is the only thing that decides colors. Must happen after
        // super.onCreate() so the bridge has constructed the WebView.
        WebSettings settings = this.bridge.getWebView().getSettings();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
            // Even when force-dark gets turned on by some future call, prefer
            // user-defined CSS over the auto-darkening algorithm.
            WebSettingsCompat.setForceDarkStrategy(
                settings,
                WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY
            );
        }

        // Edge-to-edge: let the WebView extend behind the status + navigation
        // bars instead of being squeezed between them. Required before the
        // immersive-mode call below has any visual effect.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Immersive sticky: hide both system bars for the whole game session.
        // The user can swipe from a screen edge to reveal them briefly; they
        // auto-hide again a few seconds later. Survives orientation changes,
        // dialogs, soft-keyboard show/hide.
        WindowInsetsControllerCompat insets = new WindowInsetsControllerCompat(
            getWindow(),
            getWindow().getDecorView()
        );
        insets.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
        insets.hide(WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            // Re-hide system bars after returning from a dialog, recent-apps
            // switcher, or notification shade pull. Without this they can
            // remain visible after focus returns.
            WindowInsetsControllerCompat insets = new WindowInsetsControllerCompat(
                getWindow(),
                getWindow().getDecorView()
            );
            insets.hide(WindowInsetsCompat.Type.systemBars());
        }
    }
}

