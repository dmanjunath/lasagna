import type { AreaTone } from "@web/lib/action-destination";
import type { Palette } from "@/theme";

/** An action area's soft fill, readable ink and solid edge, as TONE_STYLE maps them on the web. */
export function toneStyle(t: Palette, tone: AreaTone): { soft: string; ink: string; solid: string } {
  switch (tone) {
    case "slate":
      return { soft: t.slateSoft, ink: t.slate, solid: t.slate };
    case "brand":
      return { soft: t.brandSoft, ink: t.brandInk, solid: t.brand };
    case "positive":
      return { soft: t.positiveSoft, ink: t.positive, solid: t.positive };
    case "negative":
      return { soft: t.negativeSoft, ink: t.negative, solid: t.negative };
    case "caution":
      return { soft: t.cautionSoft, ink: t.caution, solid: t.caution };
    case "info":
      return { soft: t.infoSoft, ink: t.info, solid: t.info };
    case "sky":
      return { soft: t.skySoft, ink: t.sky, solid: t.sky };
    case "violet":
      return { soft: t.violetSoft, ink: t.violet, solid: t.violet };
    default:
      return { soft: t.canvasSunken, ink: t.contentSecondary, solid: t.contentMuted };
  }
}
