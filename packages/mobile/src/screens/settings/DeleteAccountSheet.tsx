import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError } from "@/api/client";
import { accountApi } from "@/api/profile";
import { useAuth } from "@/auth/AuthProvider";
import { space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { formStyles, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { TextField } from "@/ui/TextField";

/**
 * Delete account (Settings.tsx DeleteAccountCard), the second confirmation:
 * the password (or, without one, a code emailed as the sheet opens) and
 * DELETE typed out, then one last dialog before anything is removed.
 */
export default function DeleteAccountSheet() {
  const t = useTheme();
  const { user, signOut } = useAuth();
  const usesPassword = !!user?.hasPassword;
  const [secret, setSecret] = useState("");
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(!usesPassword);
  const [sent, setSent] = useState<"sent" | "resent" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [secretError, setSecretError] = useState("");
  const leave = useDiscardGuard((secret.length > 0 || typed.length > 0) && !deleting);

  const sendCode = async (again: boolean) => {
    setSending(true);
    setError("");
    try {
      await accountApi.requestDeletionCode();
      setSent(again ? "resent" : "sent");
    } catch {
      setError("Couldn't send a verification code. Try again.");
    } finally {
      setSending(false);
    }
  };
  // A passwordless account confirms with a code, sent once as the sheet opens.
  const started = useRef(false);
  useEffect(() => {
    if (usesPassword || started.current) return;
    started.current = true;
    void sendCode(false);
  }, [usesPassword]);

  // Trimmed: the predictive bar appends a space to a tapped word.
  const word = typed.trim();
  const ready = secret.trim().length > 0 && word === "DELETE";
  const typedError = word && !"DELETE".startsWith(word) ? "Type DELETE exactly." : null;

  const remove = async () => {
    setDeleting(true);
    setError("");
    setSecretError("");
    try {
      await accountApi.remove(usesPassword ? { password: secret } : { code: secret.trim() });
    } catch (e) {
      const rejected = e instanceof ApiError && e.status === 401;
      if (rejected) setSecretError(usesPassword ? "That password isn't right." : "That code isn't right, or it expired.");
      else setError(e instanceof ApiError && e.status >= 400 && e.status < 500 ? e.message : "Couldn't delete your account. Try again.");
      setDeleting(false);
      return;
    }
    // The server already ended the session. Back to the signed-out app.
    leave();
    await signOut();
  };

  const confirm = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert("Permanently delete your account?", "Everything in LasagnaFi is removed and your banks are disconnected. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove() },
    ]);
  };

  return (
    <>
      <SheetBar title="Delete account" left={{ title: "Cancel", onPress: () => router.back(), disabled: deleting }} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
        <Text style={[formStyles.lead, { color: t.contentSecondary }]}>
          This permanently deletes your account, your linked banks and everything in LasagnaFi.
        </Text>
        {usesPassword ? (
          <TextField
            label="Password"
            value={secret}
            onChangeText={setSecret}
            error={secretError || null}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            editable={!deleting}
          />
        ) : (
          <View style={{ gap: 8 }}>
            <View style={styles.codeLine}>
              <Text style={[styles.codeText, { color: sent === "resent" ? t.positive : t.contentMuted }]}>
                {sending && !sent ? "Sending a code to your email." : `${sent === "resent" ? "New code sent to" : "We sent a code to"} ${user?.email ?? "your email"}.`}
              </Text>
              <Button title="Resend code" variant="plain" size="compact" loading={sending && !!sent} disabled={sending || deleting} onPress={() => void sendCode(true)} />
            </View>
            <TextField
              label="Verification code"
              value={secret}
              onChangeText={setSecret}
              error={secretError || null}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              placeholder="123456"
              editable={!deleting}
            />
          </View>
        )}
        <TextField label='Type "DELETE" to confirm' value={typed} onChangeText={setTyped} error={typedError} autoCapitalize="characters" autoCorrect={false} autoComplete="off" editable={!deleting} />
        {error ? <Text style={[formStyles.error, { color: t.negative }]}>{error}</Text> : null}
        <Button title="Permanently delete" variant="destructive" loading={deleting} disabled={!ready} onPress={confirm} style={styles.delete} />
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    codeLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", columnGap: 8, paddingHorizontal: space.xxs },
    codeText: { ...type.footnote, ...weight.medium, flexShrink: 1 },
    delete: { marginTop: 8 },
  }),
);
