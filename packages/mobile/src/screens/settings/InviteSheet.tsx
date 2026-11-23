import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { householdApi } from "@/api/profile";
import { EMAIL_RE } from "@/lib/profile";
import { useTheme } from "@/theme";
import { committed } from "@/ui/feedback";
import { formStyles, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { TextField } from "@/ui/TextField";
import { invalidateHousehold } from "./HouseholdScreen";

/** Invite a partner (Settings.tsx InvitePanel): they get an email link to their own login on this household. */
export default function InviteSheet() {
  const t = useTheme();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const leave = useDiscardGuard(email.trim().length > 0 && !busy);

  const send = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) return setError("Enter a valid email address.");
    setBusy(true);
    setError("");
    try {
      await householdApi.invite(trimmed);
    } catch {
      setError("Couldn't send that invite. Check the email and try again.");
      setBusy(false);
      return;
    }
    invalidateHousehold(qc);
    leave();
    committed(`Invite sent to ${trimmed}`);
  };

  return (
    <>
      <SheetBar
        title="Invite a partner"
        left={{ title: "Cancel", onPress: () => router.back(), disabled: busy }}
        right={{ title: "Send", strong: true, busy, disabled: email.trim().length === 0, onPress: () => void send() }}
      />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
        <Text style={[formStyles.lead, { color: t.contentSecondary }]}>They'll get an email link to create their own login on this household.</Text>
        <TextField
          label="Email"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setError("");
          }}
          error={error || null}
          placeholder="partner@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => void send()}
        />
      </ScrollView>
    </>
  );
}
