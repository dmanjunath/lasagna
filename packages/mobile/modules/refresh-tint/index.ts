import { requireOptionalNativeModule } from "expo";

const native = requireOptionalNativeModule<{ setTint(light: string, dark: string): void }>("RefreshTint");

/** Tints the system pull to refresh on web screens. A no-op where the native module is absent (tests, an older build). */
export function setRefreshTint(light: string, dark: string): void {
  native?.setTint(light, dark);
}
