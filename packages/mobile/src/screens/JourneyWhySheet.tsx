import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text } from "react-native";
import { pathApi } from "@/api/home";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { whyTheseSteps } from "@/lib/journey";
import { space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card } from "@/ui/Card";
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
        {/* The first paragraph is the answer, read first. The rest explains it, set apart in a card. */}
        {paragraphs[0] ? <Text style={[styles.lead, { color: t.content }]}>{paragraphs[0]}</Text> : null}
        {paragraphs.length > 1 ? (
          <Card style={styles.card}>
            {paragraphs.slice(1).map((p) => (
              <Text key={p} style={[styles.text, { color: t.contentSecondary }]}>
                {p}
              </Text>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    body: { gap: 14 },
    lead: { ...type.body, ...weight.semibold, paddingHorizontal: space.xs },
    card: { gap: 12 },
    text: { ...type.callout },
  }),
);
