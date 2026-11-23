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
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSFaceIDUsageDescription: "Face ID unlocks the app and protects your financial data.",
      // Simulator and dev builds talk to the local API over plain http.
      ...(isLocalWeb ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
    },
  },
  plugins: [
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
  experiments: { typedRoutes: true },
};

export default config;
