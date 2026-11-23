import type { FontSource } from "expo-font";

// Every face any design system names (packages/design themes, font.*.faces).
// Classic's faces are embedded natively by the expo-font config plugin
// (app.config.ts), so they need no loading. The rest load at boot under their
// face name, and the splash stays up until they have. A test checks every
// theme's faces are covered here.

export const EMBEDDED_FACES = new Set([
  "PlusJakartaSans-Regular",
  "PlusJakartaSans-Medium",
  "PlusJakartaSans-SemiBold",
  "PlusJakartaSans-Bold",
  "InstrumentSans-SemiBold",
  "InstrumentSans-Bold",
  "Figtree-Bold",
  "Figtree-ExtraBold",
]);

export const RUNTIME_FACES: Record<string, FontSource> = {
  "Baloo2-Bold": require("../../../design/fonts/Baloo2_700Bold.ttf"),
  "Baloo2-ExtraBold": require("../../../design/fonts/Baloo2_800ExtraBold.ttf"),
  "DMSans-Regular": require("../../../design/fonts/DMSans_400Regular.ttf"),
  "DMSans-Medium": require("../../../design/fonts/DMSans_500Medium.ttf"),
  "DMSans-SemiBold": require("../../../design/fonts/DMSans_600SemiBold.ttf"),
  "DMSans-Bold": require("../../../design/fonts/DMSans_700Bold.ttf"),
  "Caveat-Bold": require("../../../design/fonts/Caveat_700Bold.ttf"),
};
