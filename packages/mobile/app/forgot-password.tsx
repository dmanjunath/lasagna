import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { authApi } from "@/api/auth";
import { AuthLayout, Banner, TextLink } from "@/components/auth/AuthKit";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";

/** packages/web/src/pages/forgot-password.tsx */
export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch {
      // The server's reason ("Not supported") means nothing to the reader.
      setError("Couldn't send the reset link. Check the email and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      mark="mark"
      title="Reset your password"
      subtitle={sent ? "Check your inbox for the next step." : "Enter your email and we'll send you a reset link."}
      footer={<TextLink title="Back to sign in" onPress={back} />}
    >
      {sent ? (
        <Banner tone="neutral">If an account exists for that email, we've sent a password reset link.</Banner>
      ) : (
        <>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            placeholder="you@example.com"
            returnKeyType="go"
            onSubmitEditing={() => email.trim() && void submit()}
          />
          {error ? <Banner>{error}</Banner> : null}
          <Button title="Send reset link" onPress={() => void submit()} loading={loading} disabled={!email.trim()} />
        </>
      )}
    </AuthLayout>
  );
}
