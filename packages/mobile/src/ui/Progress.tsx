import Svg, { ClipPath, Defs, Path, Rect } from "react-native-svg";
import { useTheme } from "@/design";
import { Track } from "./Track";

/**
 * How full a savings goal is. A jar that fills where the theme's progress skin
 * is `jar`, else the rounded track. Decorative: the caller states the percent
 * in text or in its accessibility label.
 */
export function SavingsProgress({ pct, color, size = 42 }: { pct: number; color?: string; size?: number }) {
  const d = useTheme();
  const fill = color ?? d.color.accent;
  if (d.skin.progress !== "jar") return <Track pct={pct} color={fill} />;
  return <Jar pct={pct} fill={fill} width={size} />;
}

/** The jar: a lid, a rounded body in the jar color (glass that shows on a card and on the page) and the fill rising with a soft wave. */
export function Jar({ pct, fill, width }: { pct: number; fill: string; width: number }) {
  const d = useTheme();
  const p = Math.max(0, Math.min(100, pct)) / 100;
  // The body runs from y 12 to 78 in a 64 by 80 box.
  const top = 78 - 66 * p;
  return (
    <Svg width={width} height={(width * 80) / 64} viewBox="0 0 64 80" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <ClipPath id="jar-body">
          <Rect x={6} y={12} width={52} height={66} rx={14} />
        </ClipPath>
      </Defs>
      <Rect x={12} y={2} width={40} height={9} rx={3} fill={d.color.lineStrong} />
      <Rect x={6} y={12} width={52} height={66} rx={14} fill={d.color.jar} />
      {p > 0 ? <Path d={`M6 ${top} Q32 ${top - 6} 58 ${top} V80 H6 Z`} fill={fill} clipPath="url(#jar-body)" /> : null}
    </Svg>
  );
}
