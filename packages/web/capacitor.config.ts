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
  // Match the app's light-theme background so overscroll/rubber-band areas
  // don't flash white-on-dark or foreign colors.
  backgroundColor: '#f7f9fc',
  ios: {
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // hidden by native-shell.ts once React mounts
      backgroundColor: '#f7f9fc',
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
