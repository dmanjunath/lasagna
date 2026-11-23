import { router, usePreventRemove } from "expo-router";
import { useCallback, useState } from "react";
import { ActionSheetIOS } from "react-native";

/**
 * An edit sheet's guard: while `dirty`, Cancel, the swipe down and any other
 * way out ask before throwing the edits away. Returns `leave`, which closes the
 * sheet without asking (after a save).
 */
export function useDiscardGuard(dirty: boolean): () => void {
  const [off, setOff] = useState(false);
  const disablePrevention = usePreventRemove(dirty && !off, ({ repeat }) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Discard Changes", "Keep Editing"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => {
        if (i !== 0) return;
        setOff(true);
        repeat();
      },
    );
  });
  return useCallback(() => {
    setOff(true);
    disablePrevention();
    router.back();
  }, [disablePrevention]);
}
