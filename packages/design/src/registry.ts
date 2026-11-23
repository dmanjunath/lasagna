import type { Theme } from "./schema";
import { classic } from "./themes/classic";
import { noodle } from "./themes/noodle";

/** Every design system, in picker order. */
export const themes: readonly Theme[] = [noodle, classic];

export const DEFAULT_THEME_ID = noodle.meta.id;

/** The theme with this id, or the default when the id is unknown (a theme removed since it was saved). */
export function getTheme(id: string | null | undefined): Theme {
  return themes.find((t) => t.meta.id === id) ?? noodle;
}
