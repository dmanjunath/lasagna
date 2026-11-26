import { useEffect } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

// Over-the-air updates (OTA.md). expo-updates checks and downloads on launch
// by itself (checkAutomatically: ON_LOAD). This also checks each time the app
// comes back to the foreground, so a long-lived session still picks up a new
// update. A downloaded update applies on the next cold start. Reloading while
// the app was in the background left a blank screen on return, so it waits.
// Off in development and in builds without an endpoint (Updates.isEnabled).

async function checkAndFetch() {
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline, or the endpoint is down: try again on the next foreground.
  }
}

/** Checks for an update on each return to the foreground. Mount once, at the root. */
export function useOta() {
  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkAndFetch();
    });
    return () => sub.remove();
  }, []);
}
