import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { authApi } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { AuthLayout, Banner, TextLink } from "@/components/auth/AuthKit";
import { CodeForm, type CodePurpose } from "@/components/auth/CodeForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { icon, radius, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Skeleton } from "@/ui/Skeleton";

const STATUS_COPY: Record<string, string> = {
  expired: "This invitation has expired. Ask them to send a new one.",
  used: "This invitation has already been used.",
  revoked: "This invitation was revoked.",
  not_found: "We couldn't find this invitation. Check the link and try again.",
};

/**
 * packages/web/src/pages/accept-invite.tsx, opened by /accept-invite?token=.
 * Shows who invited you, then the sign-up form with a required name. The
 * server joins the household by matching the invited email.
 */
export default function AcceptInvite() {
  const t = useTheme();
  const { status, user, completeSignIn } = useAuth();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [code, setCode] = useState<CodePurpose | null>(null);
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => authApi.validateInvite(token ?? ""),
    enabled: !!token,
    retry: false,
  });
  const leave = () => router.replace(status === "signedIn" ? "/" : "/sign-in");

  if (!token || invite.isError || (invite.data && invite.data.status !== "ok")) {
    const message = !token
      ? "This invite link is missing its token."
      : invite.isError
        ? "We couldn't validate this invitation. Please try again."
        : (STATUS_COPY[invite.data!.status] ?? "This invitation is no longer valid.");
    return (
      <AuthLayout mark="mark">
        <Banner>{message}</Banner>
        <Button title="Go to LasagnaFi" variant="secondary" onPress={leave} />
      </AuthLayout>
    );
  }

  if (invite.isPending) {
    return (
      <AuthLayout mark="none">
        <View style={styles.summary} accessible accessibilityLabel="Checking your invitation">
          <Skeleton width={56} height={56} style={{ borderRadius: radius.lg }} />
          <Skeleton width="85%" height={24} />
          <Skeleton width="60%" height={24} />
          <Skeleton width="90%" height={14} />
        </View>
      </AuthLayout>
    );
  }

  const who = invite.data.inviterName || invite.data.householdName;
  const headline = who ? `${who} invited you to join their household on LasagnaFi` : "You've been invited to join a household on LasagnaFi";

  if (code) {
    return (
      <AuthLayout
        subtitle={
          <>
            Enter the 6-digit code we sent to <Text style={[weight.semibold, { color: t.content }]}>{code.email}</Text>.
          </>
        }
      >
        <CodeForm req={code} onSession={completeSignIn} onLeave={() => setCode(null)} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      mark="none"
      footer={
        status === "signedIn" ? undefined : (
          <View style={styles.toggle}>
            <Text style={[styles.body, { color: t.contentSecondary }]}>Already have an account?</Text>
            <TextLink title="Sign in" onPress={() => router.replace("/sign-in")} />
          </View>
        )
      }
    >
      <View style={styles.summary}>
        <View style={[styles.badge, { backgroundColor: t.brandSoft }]}>
          <SymbolView name="person.2.fill" size={icon.xl} tintColor={t.brand} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
        <Text style={[styles.headline, { color: t.content }]} accessibilityRole="header">
          {headline}
        </Text>
        <Text style={[styles.body, { color: t.contentSecondary }]}>
          You'll share the same accounts, balances, and plans, each with your own private login and chat.
        </Text>
      </View>
      {status === "signedIn" ? (
        // Already signed in: the invite joins by email at sign-up or sign-in, so this account is already in a household.
        <>
          <Text style={[styles.body, { color: t.contentSecondary, textAlign: "center" }]}>
            You're already signed in as <Text style={[weight.semibold, { color: t.content }]}>{user?.email}</Text>.
          </Text>
          <Button title="Continue to LasagnaFi" onPress={leave} />
        </>
      ) : (
        <SignUpForm requireName onSession={completeSignIn} onVerify={(v) => setCode({ purpose: "signup", ...v })} />
      )}
    </AuthLayout>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  summary: { alignItems: "center", gap: 10, marginBottom: 8 },
  badge: { width: 56, height: 56, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  headline: { ...type.title, textAlign: "center" },
  body: { ...type.subhead, textAlign: "center" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6 },
}));
