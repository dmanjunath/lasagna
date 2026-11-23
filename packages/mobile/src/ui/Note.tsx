import { Text } from "react-native";
import { useTheme } from "@/design";
import { type } from "@/theme";

/**
 * A short aside, at most one per screen ("21% less!"). Handwritten and a
 * little tilted where the theme has a note accent, plain text where it has none.
 */
export function Note({ children, muted }: { children: string; muted?: boolean }) {
  const d = useTheme();
  const handwritten = d.skin.noteAccent === "handwritten";
  return (
    <Text
      style={[
        handwritten ? type.note : type.footnote,
        { color: muted ? d.color.contentMuted : d.color.brandInk },
        handwritten && { transform: [{ rotate: "-3deg" }], alignSelf: "flex-start" },
      ]}
    >
      {children}
    </Text>
  );
}
