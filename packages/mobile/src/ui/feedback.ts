import * as Haptics from "expo-haptics";
import { markWebStale } from "@/lib/web-stale";
import { showToast } from "./Toast";

// How every background commit reports back. A haptic follows the server's
// answer, never the tap: success after it lands, error after it fails. A form
// shows its own error inline instead (see the conventions doc).

/** A reversible change landed. `undo` adds the toast's Undo when the API can reverse it. */
export function committed(title: string, undo?: () => void) {
  // Every committed change is data the web pages may show.
  markWebStale();
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  showToast({ tone: "positive", title, duration: undo ? 6000 : 4000, action: undo ? { label: "Undo", onPress: undo } : undefined });
}

/** A background action failed. */
export function failed(title: string) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  showToast({ tone: "negative", title });
}

/** A win landed (a goal reached): success haptic and the celebration toast. */
export function celebrate(title: string) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  showToast({ tone: "celebrate", title, duration: 5000 });
}
