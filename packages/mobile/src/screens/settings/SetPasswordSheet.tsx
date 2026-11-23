import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { securityApi } from "@/api/profile";
import { useAuth } from "@/auth/AuthProvider";
import { useTheme } from "@/theme";
import { committed } from "@/ui/feedback";
import { formStyles, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { TextField } from "@/ui/TextField";

const MIN = 8;

/** Set or change the password (Settings.tsx PasswordSecurityCard). A passwordless account then signs in with either. */
export default function SetPasswordSheet() {
  const t = useTheme();
  const { user, refresh } = useAuth();
  const has = !!user?.hasPassword;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const leave = useDiscardGuard(password.length > 0 && !busy);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await securityApi.setPassword(password);
    } catch {
      setError("Couldn't set your password. Try again.");
      setBusy(false);
      return;
    }
    void refresh(); // hasPassword flips on the server
    leave();
    committed(has ? "Password changed" : "Password set");
  };

  return (
    <>
      <SheetBar
        title={has ? "Change password" : "Set password"}
        left={{ title: "Cancel", onPress: () => router.back(), disabled: busy }}
        right={{ title: "Save", strong: true, busy, disabled: password.length < MIN, onPress: () => void save() }}
      />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled">
        <TextField
          label={has ? "New password" : "Password"}
          hint={`At least ${MIN} characters`}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => password.length >= MIN && void save()}
        />
        {error ? <Text style={[formStyles.error, { color: t.negative }]}>{error}</Text> : null}
      </ScrollView>
    </>
  );
}
