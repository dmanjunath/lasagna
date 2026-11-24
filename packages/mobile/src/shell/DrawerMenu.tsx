import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authApi, billingApi } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { onboardingResume } from "@/lib/home";
import { openPath } from "@/lib/navigation";
import { icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { BrandLockup } from "@/ui/BrandMark";
import { SectionHeader } from "@/ui/Form";
import { failed } from "@/ui/feedback";
import { Track } from "@/ui/Track";
import { pressFeedback } from "@/ui/press";

// The contents of packages/web/src/components/layout/mobile-nav.tsx: the
// sidebar's sections minus every tab's page (Overview, and Spending, which is
// a tab here), with the brand header and the account foot pinned.

const ios17 = Number(Platform.Version) >= 17;

// The menu is navigation chrome in a fixed-width panel: its text stops growing
// here, so no label ever breaks inside a word.
const DRAWER_MAX_SCALE = 1.3;

type NavItem = { label: string; icon: SFSymbol; path: string };
const NAV_SECTIONS: Array<{ section: string; items: NavItem[] }> = [
  {
    section: "Financial insights",
    items: [
      { label: "Actions", icon: "bolt", path: "/insights" },
      { label: "Financial journey", icon: "square.3.layers.3d", path: "/financial-level" },
    ],
  },
  {
    section: "Income & expenses",
    items: [
      { label: "Transactions", icon: "arrow.left.arrow.right", path: "/transactions" },
    ],
  },
  {
    section: "Advanced",
    items: [
      { label: "Retirement", icon: "chart.line.uptrend.xyaxis", path: "/retirement" },
      { label: "Portfolio", icon: "chart.pie", path: "/portfolio" },
      { label: "Tax", icon: ios17 ? "receipt" : "doc.text", path: "/tax" },
      { label: "Debt", icon: "exclamationmark.circle", path: "/debt" },
    ],
  },
];

const NAV_PATHS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.path));
const matches = (path: string, location: string) => (path === "/" ? location === "/" : location === path || location.startsWith(`${path}/`));

/** Exact or sub-route match, the deepest matching entry winning, as on the web. */
export function isActiveNav(path: string, location: string): boolean {
  if (!matches(path, location)) return false;
  return !NAV_PATHS.some((p) => p.length > path.length && matches(p, location));
}

/** "User" for a seeded tenant or no name, else the tenant name's first word. */
export function accountFirstName(tenantName: string | undefined | null): string {
  const raw = tenantName || "";
  return raw.startsWith("Seed ") ? "User" : raw.split(" ")[0] || "User";
}

export function DrawerMenu({ activePath, close }: { activePath: string; close: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, tenant } = useAuth();

  // A drawer item goes to the tab when its page is a tab's root, and pushes in the current tab otherwise.
  const go = (path: string) => {
    close();
    openPath(path, "tab");
  };

  const firstName = accountFirstName(tenant?.name);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.head, { paddingTop: Math.max(10, insets.top) }]}>
        <BrandLockup />
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close menu" hitSlop={6} style={({ pressed }) => [styles.close, pressFeedback(t, pressed)]}>
          <SymbolView name="xmark" size={icon.md} weight="medium" tintColor={t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.nav} showsVerticalScrollIndicator>
        {NAV_SECTIONS.map(({ section, items }, i) => (
          <View key={section}>
            {i > 0 ? <View style={[styles.sectionRule, { backgroundColor: t.line }]} /> : null}
            <SectionHeader style={styles.sectionTitle} maxScale={DRAWER_MAX_SCALE}>
              {section}
            </SectionHeader>
            <View style={[styles.sectionItems, { borderLeftColor: t.line }]}>
              {items.map((item) => {
                const active = isActiveNav(item.path, activePath);
                return (
                  <Pressable
                    key={item.path}
                    onPress={() => go(item.path)}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [styles.item, pressFeedback(t, pressed)]}
                  >
                    {active ? <View style={[styles.activeBar, { backgroundColor: t.brand }]} /> : null}
                    <View style={[styles.itemIcon, { backgroundColor: active ? t.brand : t.canvasSunken }]}>
                      <SymbolView name={item.icon} size={icon.sm} weight="semibold" tintColor={active ? t.brandFg : t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
                    </View>
                    <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.itemLabel, active ? weight.bold : weight.semibold, { color: active ? t.brandInk : t.content }]}>{item.label}</Text>
                    <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.foot, { borderTopColor: t.line, paddingBottom: Math.max(10, insets.bottom) }]}>
        <OnboardingProgress onNavigate={close} />
        <PlanUsage activePath={activePath} onNavigate={close} />
        {/* Profile & Settings, which holds Admin and Sign out: pushed in the current tab. */}
        <Pressable
          onPress={() => go("/profile")}
          accessibilityRole="button"
          accessibilityLabel={`Profile and settings, ${firstName}`}
          style={({ pressed }) => [styles.account, pressFeedback(t, pressed)]}
        >
            <View style={[styles.avatar, { backgroundColor: t.brand }]}>
              <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.avatarText, { color: t.brandFg }]}>{firstName[0]?.toUpperCase() || "U"}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.accountName, { color: t.content }]} numberOfLines={1}>
                {firstName}
              </Text>
              {user?.email ? (
                <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.accountEmail, { color: t.contentMuted }]} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
            <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      </View>
    </View>
  );
}

/** "Finish setup" in the foot, only after "Finish later" (onboarding-progress.tsx). */
function OnboardingProgress({ onNavigate }: { onNavigate: () => void }) {
  const t = useTheme();
  const { user, refresh } = useAuth();
  const [resuming, setResuming] = useState(false);
  const d = onboardingResume(user);
  if (!d) return null;
  const resume = async () => {
    setResuming(true);
    onNavigate();
    try {
      await authApi.onboardingDeferred(false);
      // The app gate then opens onboarding on the step the server stored.
      await refresh();
    } catch {
      failed("Could not open setup. Please try again.");
    } finally {
      setResuming(false);
    }
  };
  return (
    <Pressable
      onPress={() => void resume()}
      disabled={resuming}
      accessibilityRole="button"
      accessibilityLabel={`Finish setup, ${d.pct}% done`}
      style={({ pressed }) => [styles.footRow, pressed && { backgroundColor: t.brandSofter }]}
    >
      <View style={styles.footLine}>
        <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.footLabel, { color: t.contentMuted }]}>Finish setup</Text>
        <View style={styles.footValueRow}>
          <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.footValue, { color: t.contentSecondary }]}>{d.pct}% done</Text>
          <SymbolView name="arrow.right" size={icon.xs} weight="semibold" tintColor={t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
      </View>
      <Track pct={d.pct} color={t.brand} height={6} />
    </Pressable>
  );
}

/** Free-plan institution usage (plan-usage.tsx): only on the free plan, and only once something is linked. */
function PlanUsage({ activePath, onNavigate }: { activePath: string; onNavigate: () => void }) {
  const t = useTheme();
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: billingApi.status });
  const [upgrading, setUpgrading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const s = billing.data;
  if (!s || s.plan !== "free" || s.usage.institutions <= 0) return null;

  const { institutions, maxInstitutions } = s.usage;
  const usedPct = Math.min(100, (institutions / Math.max(1, maxInstitutions)) * 100);
  const overLimit = institutions > maxInstitutions;
  const atLimit = institutions >= maxInstitutions;

  const upgrade = async () => {
    setUpgrading(true);
    try {
      const { url } = await billingApi.checkout();
      if (url) await WebBrowser.openBrowserAsync(url);
      // The plan changes outside the app, so read it again as the sheet closes and shortly after.
      timers.current.forEach(clearTimeout);
      timers.current = [0, 2500, 6000].map((ms) => setTimeout(() => void billing.refetch(), ms));
    } catch {
      failed("Could not start the upgrade. Please try again.");
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <View style={styles.footRow}>
      <View style={styles.footLine}>
        <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.footLabel, { color: t.contentMuted }]}>Free plan</Text>
        <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.footValue, { color: t.contentSecondary }]}>
          {overLimit ? `${institutions} institutions, ${maxInstitutions} syncing` : `${institutions} of ${maxInstitutions} institutions`}
        </Text>
      </View>
      <Track pct={usedPct} color={atLimit ? t.viz[2] : t.brand} height={6} />
      {atLimit ? (
        <View style={{ marginTop: 4 }}>
          {!overLimit ? <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.limitNote, { color: t.contentMuted }]}>You've reached your plan limit.</Text> : null}
          <FootAction icon="sparkles" title={overLimit ? "Upgrade to sync them all" : "Upgrade for 50 institutions"} busy={upgrading} onPress={() => void upgrade()} />
          {overLimit && !activePath.startsWith("/accounts") ? (
            <FootAction
              icon="minus.circle"
              title="Disconnect one to free a slot"
              onPress={() => {
                onNavigate();
                openPath("/accounts", "tab");
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FootAction({ icon: symbol, title, onPress, busy }: { icon: SFSymbol; title: string; onPress: () => void; busy?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: !!busy }}
      style={({ pressed }) => [styles.footAction, pressFeedback(t, pressed)]}
    >
      <View style={styles.footActionIcon}>
        {busy ? <ActivityIndicator size="small" /> : <SymbolView name={symbol} size={icon.md} tintColor={t.brandInk} accessibilityElementsHidden importantForAccessibility="no" />}
      </View>
      <Text maxFontSizeMultiplier={DRAWER_MAX_SCALE} style={[styles.footActionText, { color: t.brandInk }]}>{title}</Text>
    </Pressable>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 22, paddingRight: 12, paddingBottom: 4 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  nav: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  sectionRule: { height: StyleSheet.hairlineWidth, marginHorizontal: 12, marginTop: 8 },
  sectionTitle: { paddingTop: 10, paddingBottom: 4, marginHorizontal: -4 },
  sectionItems: { marginLeft: 16, paddingLeft: 8, borderLeftWidth: StyleSheet.hairlineWidth, gap: 2 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.md },
  activeBar: { position: "absolute", left: -10, width: 3, height: 20, borderRadius: 2 },
  itemIcon: { width: 28, height: 28, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  itemLabel: { ...type.subhead, flex: 1 },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  footRow: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, gap: 6 },
  footLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  footValueRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  footLabel: { ...type.caption, ...weight.semibold },
  footValue: { ...type.caption, ...weight.semibold, fontVariant: ["tabular-nums"] },
  limitNote: { ...type.caption, marginBottom: 2 },
  footAction: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: radius.sm },
  footActionIcon: { width: 18, alignItems: "center" },
  footActionText: { ...type.footnote, ...weight.semibold },
  account: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 6, minHeight: 52, borderRadius: radius.md },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { ...type.headline },
  accountName: { ...type.subhead, ...weight.bold },
  accountEmail: { ...type.caption, ...weight.regular, marginTop: 2 },
}));
