import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { pathApi } from "@/api/home";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { whyTheseSteps } from "@/lib/journey";
import { themedStyles, type, useTheme } from "@/theme";
import { formStyles, SheetBar } from "@/ui/Form";

/** "Why these steps?": what the path is made of and who chose its order (the web's popover), as a short sheet. */
export default function JourneyWhySheet() {
  const t = useTheme();
  useAmountsHidden(); // the monthly figure
  const path = useQuery({ queryKey: ["financial-path"], queryFn: pathApi.get });
  const paragraphs = path.data ? whyTheseSteps(path.data) : [];
  return (
    <>
      <SheetBar title="Why these steps?" right={{ title: "Done", strong: true, onPress: () => router.back() }} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={[formStyles.body, styles.body]}>
        {paragraphs.map((p) => (
          <Text key={p} style={[styles.text, { color: t.contentSecondary }]}>
            {p}
          </Text>
        ))}
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    body: { gap: 14 },
    text: { ...type.callout },
  }),
);
