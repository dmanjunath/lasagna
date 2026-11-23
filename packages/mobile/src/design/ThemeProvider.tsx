import { parseColor, themes } from "@lasagna/design";
import { setRefreshTint } from "../../modules/refresh-tint";
import { setWindowCanvas } from "../../modules/window-canvas";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { resolve, type ResolvedTheme } from "./resolve";
import { activeTheme, designVersion, setDesign, subscribeDesign } from "./store";

const Ctx = createContext<ResolvedTheme | null>(null);

/** The active design system in the system's color scheme. Everything under it re-renders on a switch. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const version = useSyncExternalStore(subscribeDesign, designVersion);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const value = useMemo(() => resolve(activeTheme(), scheme), [version, scheme]);
  // A web screen's pull to refresh is the system's, tinted with the theme's brand ink in both schemes.
  // The windows under every screen take the canvas, so nothing lighter or darker shows at a sliding page's corners.
  useEffect(() => {
    const { light, dark } = activeTheme().color;
    setRefreshTint(hex(light.brandInk), hex(dark.brandInk));
    paintWindows();
  }, [version]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Paints the windows and the tab and navigation containers under every screen
 * in the active theme's canvas. Again after a container mounts (the signed-in
 * tabs), since it starts in its own light default.
 */
export function paintWindows(): void {
  const { light, dark } = activeTheme().color;
  setWindowCanvas(hex(light.canvas), hex(dark.canvas));
}

const hex = (c: string) => {
  const { r, g, b } = parseColor(c);
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
};

/** Resolved tokens and skins of the active design system. */
export function useTheme(): ResolvedTheme {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme needs a ThemeProvider above it");
  return v;
}

/** The registry and the switch, for the Design picker. */
export function useDesignPicker() {
  const { id } = useTheme();
  return { themes: themes.map((t) => ({ id: t.meta.id, name: t.meta.name })), activeId: id, setDesign };
}
