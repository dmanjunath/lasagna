import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { authApi } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { AuthLayout, Banner, TextLink } from "@/components/auth/AuthKit";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";

/** packages/web/src/pages/reset-password.tsx, opened by the emailed link (/reset-password?token=). */
export default function ResetPassword() {
  const { status } = useAuth();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const requestNew = () => router.replace("/forgot-password");
  const leave = () => router.replace(status === "signedIn" ? "/" : "/sign-in");

  const submit = async () => {
    if (!token) return;
    setError("");
    if (password.length < 10) return setError("Password must be at least 10 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch {
      // The server's reason ("Not supported", a token code) means nothing here.
      setError("Couldn't reset your password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout mark="mark" title="Choose a new password" footer={<TextLink title="Request a new link" onPress={requestNew} />}>
        <Banner tone="neutral">This reset link is invalid.</Banner>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout mark="mark" title="Password updated" subtitle="Your password has been updated.">
        <Button title={status === "signedIn" ? "Continue" : "Continue to sign in"} onPress={leave} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout mark="mark" title="Choose a new password" footer={<TextLink title={status === "signedIn" ? "Cancel" : "Back to sign in"} onPress={leave} muted />}>
      <TextField
        label="New password"
        hint="At least 10 characters"
        value={password}
        onChangeText={setPassword}
        autoFocus
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        returnKeyType="next"
      />
      <TextField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {error ? <Banner action={{ title: "Request a new link", onPress: requestNew }}>{error}</Banner> : null}
      <Button title="Update password" onPress={() => void submit()} loading={loading} disabled={!password || !confirm} />
    </AuthLayout>
  );
}
