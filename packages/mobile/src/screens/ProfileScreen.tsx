import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { billingApi } from "@/api/auth";
import { householdApi, profileApi } from "@/api/profile";
import { useAuth } from "@/auth/AuthProvider";
import { RowCard, SettingsRow } from "@/components/profile/SettingsParts";
import { formatMoney } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { openPath, pushInTab } from "@/lib/navigation";
import { canDeleteAccount, FILING_STATUS_OPTIONS, initialsOf, labelOf, type ProfileSectionId } from "@/lib/profile";
import { radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Card } from "@/ui/Card";
import { ScreenScroll } from "@/ui/ScreenScroll";

// Set at build time, as VITE_DEMO_MODE is for the web.
export const DEMO_BUILD = process.env.EXPO_PUBLIC_DEMO_MODE === "true";

const openSection = (id: ProfileSectionId) => pushInTab(`/profile/${id}`);

/**
 * Profile & Settings (/profile, Settings.tsx on the web) as a grouped list:
 * who you are, then each section on its own pushed screen. Categories and
 * Transaction rules are still the web page's. Sign out and Delete account
 * close the list.
 */
export default function ProfileScreen() {
  const t = useTheme();
  useAmountsHidden(); // the income line
  const { user, tenant, signOut } = useAuth();
  const isOwner = user?.role === "owner";
  const profile = useQuery({ queryKey: ["financial-profile"], queryFn: profileApi.get });
  const members = useQuery({ queryKey: ["household-profiles"], queryFn: householdApi.profiles, enabled: !DEMO_BUILD });
  const invites = useQuery({ queryKey: ["household-invites"], queryFn: householdApi.invites, enabled: isOwner && !DEMO_BUILD });
  const billing = useQuery({ queryKey: ["billing-status"], queryFn: billingApi.status });

  const name = tenant?.name || user?.name || "Profile";
  const p = profile.data?.financialProfile ?? null;

  // A line under a row only where it says something.
  const personal = p ? [p.age != null ? `Age ${p.age}` : null, p.filingStatus ? labelOf(FILING_STATUS_OPTIONS, p.filingStatus) : null, p.stateOfResidence || null].filter(Boolean).join(", ") : "";
  const income = p?.annualIncome != null ? `${formatMoney(p.annualIncome, true)} a year` : "";
  const memberCount = members.data?.members.length ?? 0;
  const pending = (invites.data?.invites ?? []).filter((i) => new Date(i.expiresAt).getTime() > Date.now()).length;
  const household = members.data
    ? [memberCount <= 1 ? "Just you" : `${memberCount} members`, pending > 0 ? `${pending} ${pending === 1 ? "invite" : "invites"} pending` : null].filter(Boolean).join(", ")
    : "";
  const plan = billing.data ? (billing.data.plan === "pro" ? "Pro" : "Free plan") : "";

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([profile.refetch(), members.refetch(), invites.refetch(), billing.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);

  const version = Constants.expoConfig?.version;
  const build = Constants.expoConfig?.ios?.buildNumber;

  return (
    <ScreenScroll
      title="Profile"
      refreshing={pulling}
      onRefresh={() => void onPull()}
    >
      {/* Who is signed in, under the page's own title (which the bar takes over on scroll). */}
      <Card>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: t.brandSoft }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={[styles.initials, { color: t.brandInk }]}>{initialsOf(name)}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.name, { color: t.content }]} numberOfLines={2}>
              {name}
            </Text>
            {user?.email ? (
              <Text style={[styles.email, { color: t.contentMuted }]} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      <RowCard>
        <SettingsRow symbol="person" title="Personal info" detail={personal || null} onPress={() => openSection("personal")} />
        <SettingsRow symbol="briefcase" title="Income & employment" detail={income || null} onPress={() => openSection("income")} />
      </RowCard>

      <RowCard>
        {!DEMO_BUILD ? <SettingsRow symbol="person.2" title="Household" detail={household || null} onPress={() => openSection("household")} /> : null}
        <SettingsRow symbol="sparkles" title="Plan & billing" detail={plan || null} onPress={() => openSection("billing")} />
        <SettingsRow symbol="key" title="Security" onPress={() => openSection("security")} />
        <SettingsRow symbol="slider.horizontal.3" title="Preferences" onPress={() => openSection("preferences")} />
      </RowCard>

      {/* Still the web page's sections, opened on it. */}
      <RowCard>
        <SettingsRow symbol="tag" title="Categories" onPress={() => openPath("/profile#categories")} />
        <SettingsRow symbol="line.3.horizontal.decrease" title="Transaction rules" onPress={() => openPath("/profile#rules")} />
      </RowCard>

      {user?.isAdmin ? (
        <RowCard>
          <SettingsRow symbol="wrench.and.screwdriver" title="Admin" onPress={() => openPath("/admin")} />
        </RowCard>
      ) : null}

      <RowCard tiles={false}>
        <SettingsRow title="Sign out" tone="brand" chevron={false} onPress={confirmSignOut} />
        {canDeleteAccount(user, DEMO_BUILD) ? <SettingsRow title="Delete account" tone="negative" chevron={false} onPress={() => confirmDelete(!!user?.hasPassword)} /> : null}
      </RowCard>

      {version ? <Text style={[styles.version, { color: t.contentMuted }]}>{`Version ${version}${build ? ` (${build})` : ""}`}</Text> : null}
    </ScreenScroll>
  );
}

/**
 * The first of two confirmations before anything is deleted: what it means,
 * then the sheet that asks for the password (or an emailed code) and DELETE.
 */
export function confirmDelete(usesPassword: boolean) {
  Alert.alert(
    "Delete your account?",
    `This permanently deletes your account, your linked banks and everything in LasagnaFi. You'll confirm with ${usesPassword ? "your password" : "a code we email you"}.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: "destructive", onPress: () => pushInTab("/delete-account") },
    ],
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    identity: { flexDirection: "row", alignItems: "center", gap: 14 },
    avatar: { width: 56, height: 56, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
    initials: { ...type.title1 },
    name: { ...type.title },
    email: { ...type.subhead, ...weight.medium },
    version: { ...type.footnote, textAlign: "center", marginTop: 8 },
  }),
);
