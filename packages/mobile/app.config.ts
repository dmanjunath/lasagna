import type { ExpoConfig } from "expo/config";
// The launch screen and the root view take the default theme's canvas, so the
// hand-off from launch to the first screen shows no other color. Written from
// the theme by scripts/gen-brand-assets.mts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const brand: { canvas: { light: string; dark: string } } = require("./assets/brand.json");

// Hostnames come from env at build time (see scripts/ios-archive.sh). Nothing
// that names real infrastructure lives in this file.
const webHost = process.env.EXPO_PUBLIC_WEB_URL ? new URL(process.env.EXPO_PUBLIC_WEB_URL).hostname : null;
const isLocalWeb = !webHost || webHost === "localhost";

// Over-the-air updates (OTA.md). The endpoint and the code-signing certificate
// come from env at build and publish time (scripts/ios-archive.sh and
// scripts/ota-publish.sh, which copy the certificate to build/). Without an
// endpoint, updates stay off and the app runs its embedded bundle only.
const updatesUrl = process.env.EXPO_UPDATES_URL;

// Push notifications through Firebase Cloud Messaging, as the old app did. The
// Firebase config (lasagna-infra/ios/GoogleService-Info.plist) is copied to
// build/ by scripts/ota-env.sh. Without it the app builds with no push, which
// is what a self-hosted build gets.
const FIREBASE_PLIST = "./build/GoogleService-Info.plist";
// Expo's config loader runs this file as CommonJS, so __dirname is set.
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hasPush: boolean = require("node:fs").existsSync(require("node:path").join(__dirname, FIREBASE_PLIST));

const config: ExpoConfig = {
  name: "LasagnaFi",
  slug: "lasagna",
  scheme: "lasagna",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  // The root view behind every screen (expo-system-ui). Light canvas here, and
  // the app sets the dark one at runtime, so no white or black frame shows
  // between the launch screen and the first screen.
  backgroundColor: brand.canvas.light,
  ios: {
    bundleIdentifier: "com.lasagnafi.app",
    buildNumber: process.env.IOS_BUILD_NUMBER ?? "1",
    supportsTablet: false,
    associatedDomains: isLocalWeb ? [] : [`applinks:${webHost}`, `webcredentials:${webHost}`],
    // Xcode's App Store export switches this to production.
    ...(hasPush ? { googleServicesFile: FIREBASE_PLIST, entitlements: { "aps-environment": "development" } } : {}),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSFaceIDUsageDescription: "Face ID unlocks the app and protects your financial data.",
      // Simulator and dev builds talk to the local API over plain http.
      ...(isLocalWeb ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
      ...(hasPush ? { UIBackgroundModes: ["remote-notification"] } : {}),
    },
  },
  plugins: [
    ...(hasPush
      ? [
          "@react-native-firebase/app",
          "@react-native-firebase/messaging",
          // Firebase's Apple SDK ships only through Swift Package Manager, which
          // needs dynamic frameworks.
          ["expo-build-properties", { ios: { useFrameworks: "dynamic" } }] as [string, unknown],
        ]
      : []),
    "expo-router",
    "./plugins/with-refresh-tint",
    "expo-secure-store",
    "expo-web-browser",
    ["expo-local-authentication", { faceIDPermission: "Face ID unlocks the app and protects your financial data." }],
    "expo-system-ui",
    [
      // The theme's mascot at the centre of the canvas: a 2732pt square
      // artwork, transparent around the mascot, filling the screen
      // (scaleAspectFill), so AppCover can draw it at the same frame.
      // Drawn by scripts/gen-brand-assets.ts.
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        enableFullScreenImage_legacy: true,
        resizeMode: "cover",
        backgroundColor: brand.canvas.light,
        dark: { image: "./assets/splash-dark.png", backgroundColor: brand.canvas.dark },
      },
    ],
    [
      // The web app's faces, embedded so the first frame already uses them:
      // Plus Jakarta Sans (text), Instrument Sans (headings), Figtree (figures,
      // the web's "LF Numerals"). All SIL OFL, licenses beside the files.
      "expo-font",
      {
        fonts: [
          "./assets/fonts/PlusJakartaSans_400Regular.ttf",
          "./assets/fonts/PlusJakartaSans_500Medium.ttf",
          "./assets/fonts/PlusJakartaSans_600SemiBold.ttf",
          "./assets/fonts/PlusJakartaSans_700Bold.ttf",
          "./assets/fonts/InstrumentSans_600SemiBold.ttf",
          "./assets/fonts/InstrumentSans_700Bold.ttf",
          "./assets/fonts/Figtree_700Bold.ttf",
          "./assets/fonts/Figtree_800ExtraBold.ttf",
        ],
      },
    ],
  ],
  // An update only reaches builds whose native code matches it: the
  // fingerprint changes with any native module, plugin or native config.
  runtimeVersion: { policy: "fingerprint" },
  updates: updatesUrl
    ? {
        url: updatesUrl,
        enabled: true,
        // Check on launch without holding it: the app opens on what it has and
        // a new update applies the next time it starts.
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
        // Only updates signed with our key are accepted.
        codeSigningCertificate: "./build/ota-certificate.pem",
        codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
      }
    : { enabled: false },
  // Read by src/lib/push.ts. Not ios.googleServicesFile: the public config
  // inlines that whole file, and ota-publish.sh strips it from every update.
  extra: { push: hasPush },
  experiments: { typedRoutes: true },
};

export default config;
