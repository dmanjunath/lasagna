import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell config. The iOS/Android apps bundle the built SPA (dist/) and
 * talk to the hosted API — set VITE_API_URL (e.g. https://app.lasagnafi.com)
 * before `pnpm cap:sync` so api.ts hits the right host. Auth inside the shell
 * uses the Bearer-token path (see lib/native.ts), not cookies.
 */
const config: CapacitorConfig = {
  appId: 'com.lasagnafi.app',
  appName: 'LasagnaFi',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
  },
};

export default config;
