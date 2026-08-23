import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell config. The iOS/Android apps bundle the built SPA (dist/) and
 * talk to the hosted API — set VITE_API_URL to the API host (e.g.
 * https://api.lasagnafi.com, NOT the app./SPA host) before `pnpm cap:sync` so
 * api.ts hits the right host. Auth inside the shell uses the Bearer-token path
 * (see lib/native.ts), not cookies.
 */
const config: CapacitorConfig = {
  appId: 'com.lasagnafi.app',
  appName: 'LasagnaFi',
  webDir: 'dist',
  // No root backgroundColor: it can only hold one value, so it painted the
  // webview light on a dark device. MainViewController sets a dark-aware colour
  // instead, and the storyboard uses the SplashBackground colour set.
  ios: {
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // hidden by native-shell.ts once React mounts
      // No backgroundColor on purpose. The plugin re-instantiates
      // LaunchScreen.storyboard and, when this is set, overwrites the root
      // view's colour with it — and that root view IS the image view. A single
      // light value there paints the letterbox bars light on a dark device for
      // the whole boot. Left unset, the storyboard's SplashBackground colour
      // set (light + dark) survives.
    },
    // Over-the-air web-bundle updates, fully self-hosted — see lib/ota.ts.
    // autoUpdate is off because Capgo's built-in loop POSTs to an update
    // server; we drive check/download/apply ourselves against a static
    // manifest. The three URLs default to Capgo's cloud, so they are blanked
    // to guarantee the app never phones home to a third party.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: '',
      statsUrl: '',
      channelUrl: '',
    },
  },
};

export default config;
