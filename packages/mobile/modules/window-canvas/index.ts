import { requireOptionalNativeModule } from "expo";

const native = requireOptionalNativeModule<{ setCanvas(light: string, dark: string): void }>("WindowCanvas");

/** Paints the windows under every screen in the canvas, each scheme's own. A no-op where the native module is absent (tests, an older build). */
export function setWindowCanvas(light: string, dark: string): void {
  native?.setCanvas(light, dark);
}
