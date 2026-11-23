import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { homeApi } from "@/api/home";
import { useAuth } from "@/auth/AuthProvider";
import { onboardingResume } from "@/lib/home";
import { themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardHeader } from "@/ui/Card";
import { failed } from "@/ui/feedback";
import { Track } from "@/ui/Track";

/** Shown only when the user chose "Finish later" and has not finished since. */
export function OnboardingResumeCard() {
  const t = useTheme();
  const { user, refresh } = useAuth();
  const [resuming, setResuming] = useState(false);
  const d = onboardingResume(user);
  if (!d) return null;

  const resume = async () => {
    setResuming(true);
    try {
      await homeApi.onboardingDeferred(false);
      // Undeferred, the app gate opens onboarding on the step the server stored.
      await refresh();
    } catch {
      failed("Could not open setup. Please try again.");
    } finally {
      setResuming(false);
    }
  };

  return (
    <Card style={{ gap: 12 }}>
      <CardHeader title="Finish setting up" />
      <Text style={[styles.pct, { color: t.contentMuted }]}>{d.pct}% done</Text>
      <Text style={[styles.body, { color: t.contentSecondary }]}>Your plan is built from these answers. You stopped at step {d.step} of 3.</Text>
      <Track pct={d.pct} color={t.brand} height={6} />
      <Button title="Continue" variant="secondary" loading={resuming} onPress={() => void resume()} />
    </Card>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  pct: { ...type.footnote, ...weight.semibold, fontVariant: ["tabular-nums"] },
  body: { ...type.subhead },
}));
