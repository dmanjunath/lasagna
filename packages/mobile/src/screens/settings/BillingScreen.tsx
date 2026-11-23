import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { billingApi } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, RoleTile } from "@/components/profile/SettingsParts";
import { FREE_FEATURES, planSummary, PRO_FEATURES, PRO_PRICE } from "@/lib/profile";
import { icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardSkeleton } from "@/ui/Card";
import { formStyles } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { ErrorState } from "@/ui/State";

/**
 * Plan & billing (Settings.tsx PlanCard). Upgrading and managing the
 * subscription link out to Stripe in the browser sheet, as the Capacitor app
 * did: nothing is bought inside the app. The plan changes outside it, so it is
 * read again as the sheet closes and shortly after, while the webhook lands.
 */
export default function BillingScreen() {
  const t = useTheme();
  const { refresh } = useAuth();
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: billingApi.status });
  const [opening, setOpening] = useState<null | "upgrade" | "manage">(null);
  const [error, setError] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const linkOut = async (kind: "upgrade" | "manage") => {
    setOpening(kind);
    setError("");
    try {
      const { url } = kind === "upgrade" ? await billingApi.checkout() : await billingApi.portal();
      if (url) await WebBrowser.openBrowserAsync(url);
      timers.current.forEach(clearTimeout);
      timers.current = [0, 2500, 6000].map((ms) =>
        setTimeout(() => {
          void billing.refetch();
          void refresh();
        }, ms),
      );
    } catch {
      setError(kind === "upgrade" ? "Couldn't start the upgrade. Try again in a moment." : "Couldn't open the billing portal. Try again in a moment.");
    } finally {
      setOpening(null);
    }
  };

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await billing.refetch();
    } finally {
      setPulling(false);
    }
  };

  const s = billing.data;
  const isPro = s?.plan === "pro";
  const periodDate = s?.currentPeriodEnd ? new Date(s.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  // The web's accent tier.
  const proFill = t.accentSoft;
  const proInk = t.accentInk;

  return (
    <ScreenScroll title="Plan & billing" refreshing={pulling} onRefresh={() => void onPull()}>
      {billing.isPending ? (
        <CardSkeleton lines={5} />
      ) : billing.isError && !s ? (
        <ErrorState compact title="Couldn't load your plan" body="Check your connection and try again." onRetry={() => void billing.refetch()} />
      ) : s ? (
        <Card style={{ gap: 16 }}>
          <View style={styles.head}>
            <RoleTile symbol="sparkles" role="neutral" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.plan, { color: t.content }]} accessibilityRole="header">
                {isPro ? "Pro" : "Free plan"}
              </Text>
              <Text style={[styles.summary, { color: t.contentMuted }]}>{planSummary(s)}</Text>
            </View>
            {isPro && s.cancelAtPeriodEnd ? <Badge label="Canceling" tone="caution" /> : null}
          </View>

          {isPro ? (
            <>
              <Features features={PRO_FEATURES} ink={t.brandInk} />
              {s.cancelAtPeriodEnd && periodDate ? (
                <Text style={[styles.body, { color: t.contentMuted }]}>{`Your subscription is set to cancel on ${periodDate}. You'll keep Pro until then, and you can reactivate any time from Manage subscription.`}</Text>
              ) : null}
              <Button title="Manage subscription" variant="tinted" icon="arrow.up.right" loading={opening === "manage"} disabled={opening !== null} onPress={() => void linkOut("manage")} />
            </>
          ) : (
            <>
              <Card nested style={[styles.tier, { backgroundColor: t.canvasSunken }]}>
                <View style={styles.tierHead}>
                  <Text style={[styles.tierName, { color: t.content }]}>Free</Text>
                  <Text style={[styles.tierMeta, { color: t.contentMuted }]}>Current</Text>
                </View>
                <Features features={FREE_FEATURES} ink={t.brandInk} />
              </Card>
              <Card nested style={[styles.tier, { backgroundColor: proFill }]}>
                <View style={styles.tierHead}>
                  <Text style={[styles.tierName, { color: proInk }]}>Pro</Text>
                  <Text style={[styles.tierMeta, weight.bold, { color: proInk }]}>{PRO_PRICE}</Text>
                </View>
                <Features features={PRO_FEATURES} ink={proInk} />
              </Card>
              <Button title="Upgrade to Pro" icon="sparkles" iconLeading loading={opening === "upgrade"} disabled={opening !== null} onPress={() => void linkOut("upgrade")} />
            </>
          )}
          {error ? <Text style={[formStyles.error, { color: t.negative }]}>{error}</Text> : null}
        </Card>
      ) : (
        <Skeleton height={120} />
      )}
    </ScreenScroll>
  );
}

function Features({ features, ink }: { features: string[]; ink: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {features.map((f) => (
        <View key={f} style={styles.feature}>
          <SymbolView name="checkmark" size={icon.xs} weight="bold" tintColor={ink} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={[styles.featureText, { color: t.contentSecondary }]}>{f}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    head: { flexDirection: "row", alignItems: "center", gap: 12 },
    plan: { ...type.title },
    summary: { ...type.footnote, ...weight.medium },
    body: { ...type.footnote },
    tier: { padding: 14, gap: 10, borderRadius: radius.md },
    tierHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    tierName: { ...type.subhead, ...weight.bold },
    tierMeta: { ...type.footnote, ...weight.semibold, fontVariant: ["tabular-nums"] },
    feature: { flexDirection: "row", alignItems: "center", gap: 8 },
    featureText: { ...type.footnote, ...weight.medium, flex: 1 },
  }),
);
