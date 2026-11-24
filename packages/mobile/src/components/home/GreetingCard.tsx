import type { ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useTheme as useDesign } from "@/design";
import { hasRoleColor } from "@/design/tint";
import { HIDDEN_AMOUNT, useAmountsHidden } from "@/lib/hide-amounts";
import { radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card, heroEdge } from "@/ui/Card";
import { RefreshMascot } from "@/ui/PullRefresh";
import { Note } from "@/ui/Note";
import { Skeleton } from "@/ui/Skeleton";
import { Sparkle } from "@/ui/Sparkle";
import { textScaleKey } from "@/ui/text-scale";

const wholeUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.abs(n));

/**
 * Home's opening: the theme's mascot says hello in a speech bubble, with the
 * open actions and the change in net worth since the last visit. A rise is
 * the screen's one handwritten note, with a sparkle. The bubble is Home's
 * hero, so it wears the money-in tint where the theme has role colors, and
 * the quiet card fill where it has none.
 */
export function GreetingCard({
  greeting,
  actionSentence,
  netWorth,
  loading,
  speaker = true,
  children,
}: {
  /** On the `card` greeting skin, what the card holds under the greeting (Home's actions). */
  children?: ReactNode;
  /** False when the screen's own art takes the one mascot moment (a whole-screen empty or error state). */
  speaker?: boolean;
  greeting: string;
  actionSentence: { count: string; lead: string; focus: string | null } | null;
  netWorth: { delta: number; since: string } | null;
  loading: boolean;
}) {
  const t = useTheme();
  const d = useDesign();
  const hidden = useAmountsHidden();
  // Whole dollars, so a change under 50 cents reads "unchanged", never "up $0".
  const delta = netWorth ? Math.round(netWorth.delta) : 0;
  const up = !!netWorth && delta > 0;
  const strong = [weight.semibold, { color: t.content }];
  const speaks = speaker && !!d.mascot;
  // Large text leaves the bubble too narrow beside the mascot, so the mascot stands above it.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.3;
  // A text-size change while the app is open leaves the sentence measured at the
  // old size. Remounting on the new scale lays it out again (see text-scale.ts).
  const layoutKey = textScaleKey(fontScale);

  const summary = loading ? (
    <View style={{ gap: 8, paddingTop: 4 }}>
      <Skeleton height={13} />
      <Skeleton height={13} width="70%" />
    </View>
  ) : actionSentence || netWorth ? (
    <Text style={[styles.summary, { color: t.contentSecondary }]}>
      {actionSentence ? (
        <>
          You have <Text style={strong}>{actionSentence.count}</Text>
          {actionSentence.focus ? (
            <>
              , {actionSentence.lead} <Text style={strong}>{actionSentence.focus}</Text>.
            </>
          ) : (
            "."
          )}
          {netWorth ? " " : ""}
        </>
      ) : null}
      {netWorth ? (
        <>
          Your net worth is{" "}
          {delta === 0 ? (
            <Text style={strong}>unchanged</Text>
          ) : (
            <Text style={[weight.semibold, { color: delta > 0 ? t.positive : t.negative }]}>
              {delta > 0 ? "up" : "down"} {hidden ? HIDDEN_AMOUNT : wholeUsd(delta)}
            </Text>
          )}{" "}
          {netWorth.since}.
        </>
      ) : null}
    </Text>
  ) : null;

  // The `card` skin: a large greeting on a soft-gradient card that holds the
  // actions, the change in words in the sentence (no handwritten note).
  if (d.skin.greeting === "card") {
    return (
      <Card
        key={layoutKey}
        style={styles.card}
        wash={`radial-gradient(80% 130% at 0% 0%, ${t.accentSofter}, transparent 58%), radial-gradient(70% 130% at 100% 0%, ${t.infoSoft}, transparent 64%)`}
      >
        <View style={{ gap: 10 }}>
          <Text style={[styles.greetingLarge, { color: t.content }]} accessibilityRole="header">
            {greeting}
          </Text>
          {summary}
        </View>
        {children}
      </Card>
    );
  }

  return (
    <View key={layoutKey} style={[styles.wrap, stacked && styles.stacked]}>
      {speaks ? (
        <View style={[styles.mascot, stacked && { alignSelf: "flex-start", marginBottom: 0 }]}>
          {/* Home's refresh indicator where the refresh skin is the mascot. */}
          <RefreshMascot width={84} />
        </View>
      ) : null}
      <View
        style={[
          styles.bubble,
          { backgroundColor: hasRoleColor(d.color, "income") ? d.color.tint.income.fill : d.color.surfaceMuted, borderRadius: radius.lg },
          // Framed like every other card under the soft skin, in a deeper shade of its tint.
          d.skin.card === "soft" && hasRoleColor(d.color, "income") && { borderWidth: 1, borderColor: heroEdge(d.color.tint.income, d.scheme === "dark"), boxShadow: d.shadow.sm },
          // The corner nearest the speaker is the bubble's tail.
          speaks && (stacked ? { borderTopLeftRadius: radius.xs - 2, marginBottom: 0 } : { borderBottomLeftRadius: radius.xs - 2 }),
        ]}
      >
        <Text style={[styles.greeting, { color: t.content }]} accessibilityRole="header">
          {greeting}
        </Text>
        {loading ? (
          <View style={{ gap: 8, paddingTop: 4 }}>
            <Skeleton height={13} />
            <Skeleton height={13} width="70%" />
          </View>
        ) : actionSentence || (netWorth && !up) ? (
          <Text style={[styles.summary, { color: t.contentSecondary }]}>
            {actionSentence ? (
              <>
                You have <Text style={strong}>{actionSentence.count}</Text>
                {actionSentence.focus ? (
                  <>
                    , {actionSentence.lead} <Text style={strong}>{actionSentence.focus}</Text>.
                  </>
                ) : (
                  "."
                )}
                {netWorth && !up ? " " : ""}
              </>
            ) : null}
            {netWorth && !up ? (
              <>
                Your net worth is{" "}
                {delta === 0 ? (
                  <Text style={strong}>unchanged</Text>
                ) : (
                  <Text style={[weight.semibold, { color: t.content }]}>down {hidden ? HIDDEN_AMOUNT : wholeUsd(delta)}</Text>
                )}{" "}
                {netWorth.since}.
              </>
            ) : null}
          </Text>
        ) : null}
        {!loading && up && netWorth ? (
          // The win, said once: the note carries the amount and when.
          <View style={styles.win} accessible accessibilityLabel={`Your net worth is up ${hidden ? "an amount" : wholeUsd(delta)} ${netWorth.since}`}>
            <Note>{`up ${hidden ? HIDDEN_AMOUNT : wholeUsd(delta)} ${netWorth.since}!`}</Note>
            <Sparkle size={20} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
    stacked: { flexDirection: "column", alignItems: "stretch" },
    mascot: { marginBottom: -2 },
    bubble: { flex: 1, paddingHorizontal: space.card, paddingVertical: 14, gap: 6, marginBottom: 14 },
    greeting: { ...type.title2 },
    greetingLarge: { ...type.largeTitle },
    card: { gap: 18, paddingTop: 24 },
    summary: { ...type.callout },
    win: { flexDirection: "row", alignItems: "center", gap: 4 },
  }),
);
