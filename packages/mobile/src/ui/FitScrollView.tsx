import { useState } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";

/**
 * A ScrollView for a screen whose content usually fits: it neither scrolls
 * nor bounces until the content is taller than the room it has (the keyboard
 * up, large text, a small phone).
 */
export function FitScrollView(props: ScrollViewProps) {
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  // Half a point of slack for rounding between the two measurements.
  const overflows = box > 0 && content > box + 0.5;
  return (
    <ScrollView
      {...props}
      scrollEnabled={overflows}
      bounces={overflows}
      alwaysBounceVertical={false}
      onLayout={(e) => {
        setBox(e.nativeEvent.layout.height);
        props.onLayout?.(e);
      }}
      onContentSizeChange={(w, h) => {
        setContent(h);
        props.onContentSizeChange?.(w, h);
      }}
    />
  );
}
