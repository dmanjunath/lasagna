import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { authApi, type Session } from "@/api/auth";
import { themedStyles, type } from "@/theme";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { Banner, errorText, TextLink, type ConsentValues } from "./AuthKit";

export type CodePurpose =
  | { purpose: "login"; email: string }
  | { purpose: "signup"; email: string; setPassword: boolean; consents: ConsentValues };

/**
 * The 6-digit code step (packages/web/src/pages/verify-email.tsx). Sign-in
 * posts /auth/login/code. Sign-up posts /auth/verify-email with the
 * agreements and whether a password was set.
 */
export function CodeForm({ req, onSession, onLeave }: { req: CodePurpose; onSession: (s: Session) => Promise<void>; onLeave: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const signup = req.purpose === "signup";

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      const s =
        req.purpose === "login"
          ? await authApi.loginCode(req.email, code.trim())
          : await authApi.verifyEmail({ email: req.email, code: code.trim(), setPassword: req.setPassword, ...req.consents });
      await onSession(s);
    } catch (e) {
      setError(errorText(e));
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    try {
      await authApi.loginSendCode(req.email);
      setResent(true);
    } catch {
      // No enumeration: stay quiet, as the web does.
    }
  };

  return (
    <>
      <TextField
        label="Verification code"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        returnKeyType="go"
        onSubmitEditing={() => code && void submit()}
        style={styles.code}
      />
      {error ? <Banner>{error}</Banner> : null}
      <Button title={signup ? "Create account" : "Sign in"} onPress={() => void submit()} loading={loading} disabled={!code} />
      <View style={styles.links}>
        <TextLink title={resent ? "Code re-sent" : "Didn't get a code? Resend"} onPress={() => void resend()} disabled={resent} />
        <TextLink title={signup ? "Back to sign in" : "Use another email"} onPress={onLeave} muted />
      </View>
    </>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  code: { ...type.amount, letterSpacing: 8, textAlign: "center" },
  links: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, paddingTop: 2 },
}));
