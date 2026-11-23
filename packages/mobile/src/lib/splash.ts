import * as SplashScreen from "expo-splash-screen";

// The launch screen stays up until the first screen has laid out, then fades
// (the Capacitor app's 200ms), so no blank frame shows between the two.
SplashScreen.setOptions({ fade: true, duration: 200 });

let hidden = false;

/** Called from the first screen's onLayout. Waits one frame so that layout has painted. */
export function hideSplashOnce() {
  if (hidden) return;
  hidden = true;
  requestAnimationFrame(() => void SplashScreen.hideAsync().catch(() => {}));
}
