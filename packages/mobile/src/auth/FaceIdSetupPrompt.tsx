import * as LocalAuthentication from "expo-local-authentication";
import { useEffect } from "react";
import { Alert } from "react-native";
import { isSetupPrompted, setLockEnabled, setSetupPrompted } from "./biometric";
import { registerPasskey } from "./passkey-flows";

/**
 * The one-time offer after sign-in (FaceIdSetupPrompt.tsx on the web): turning
 * Face ID on enables the app lock AND registers a passkey for the next sign-in.
 * Shown once. Accepting, declining, or a device without enrolled biometrics
 * marks it asked. Sign-out re-arms it.
 */
export function FaceIdSetupPrompt() {
  useEffect(() => {
    if (isSetupPrompted()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
        if (cancelled) return;
        if (!hardware || !enrolled) return setSetupPrompted(true);
        offer();
      } catch {
        // Ask again next launch.
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return null;
}

function offer(failed = false) {
  Alert.alert(
    failed ? "Couldn't turn on Face ID" : "Turn on Face ID?",
    failed ? undefined : "Use Face ID to lock LasagnaFi when you leave, and to sign in without a password next time.",
    [
      { text: "Not now", style: "cancel", onPress: () => setSetupPrompted(true) },
      { text: failed ? "Try again" : "Enable Face ID", isPreferred: true, onPress: () => void enable() },
    ],
  );
}

async function enable() {
  // Confirm Face ID passes before turning the lock on, so a broken sensor can't lock anyone out.
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Enable Face ID for LasagnaFi", disableDeviceFallback: false });
  if (!r.success) return offer(true);
  setLockEnabled(true);
  setSetupPrompted(true);
  // Best effort: the lock is already on, so a passkey failure must not undo it.
  await registerPasskey().catch(() => {});
}
