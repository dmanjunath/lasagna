import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { authApi, type Session } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { hasRegisteredPasskey } from "@/auth/passkey";
import { isPasskeyCancel, signInWithPasskey } from "@/auth/passkey-flows";
import { AuthLayout, Banner, errorText, isEmail, OrDivider, TextLink } from "@/components/auth/AuthKit";
import { CodeForm, type CodePurpose } from "@/components/auth/CodeForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";

type Mode = { kind: "signin" } | { kind: "signup"; handedOff: boolean } | { kind: "code"; req: CodePurpose };

/**
 * packages/web/src/pages/Login.tsx and verify-email.tsx as one screen.
 * Sign-in asks for the email first, then the password or an emailed code,
 * whichever the account uses. An unknown email carries over to sign-up.
 */
export default function SignIn() {
  const t = useTheme();
  const { completeSignIn } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === "signup" ? { kind: "signup", handedOff: false } : { kind: "signin" });
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  // The address /login/start last answered "password" for. The email stays
  // editable on the password step, and a change sends it back through that check.
  const [checkedEmail, setCheckedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(false);

  useEffect(() => {
    void hasRegisteredPasskey().then(setPasskeyReady);
  }, []);

  const onSession = (s: Session) => completeSignIn(s);

  const toSignIn = () => {
    setMode({ kind: "signin" });
    setStep("email");
    setPassword("");
    setError("");
  };

  const toSignUp = (handedOff: boolean) => {
    setMode({ kind: "signup", handedOff });
    setPassword("");
    setError("");
  };

  const passwordLogin = async () => {
    if (!password) return setError("Password is required");
    setLoading(true);
    try {
      const res = await authApi.login(email.trim(), password);
      // The account's email isn't verified yet: finish on the code screen.
      if ("needsVerification" in res) setMode({ kind: "code", req: { purpose: "login", email: email.trim() } });
      else await onSession(res);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const emailContinue = async () => {
    setLoading(true);
    try {
      const { step: next } = await authApi.loginStart(email.trim());
      if (next === "code") return setMode({ kind: "code", req: { purpose: "login", email: email.trim() } });
      if (next === "signup") return toSignUp(true);
      const wasPassword = step === "password";
      setCheckedEmail(email);
      setStep("password");
      // The email was edited on the password step, so carry on signing in.
      if (wasPassword) await passwordLogin();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const submit = () => {
    setError("");
    if (!email.trim()) return setError("Email is required");
    if (!isEmail(email)) return setError("Enter a valid email address");
    if (step === "password" && email === checkedEmail) return void passwordLogin();
    return void emailContinue();
  };

  const emailACode = async () => {
    setError("");
    setLoading(true);
    try {
      await authApi.loginSendCode(email.trim());
      setMode({ kind: "code", req: { purpose: "login", email: email.trim() } });
    } catch (e) {
      // The server's reason (such as "Not supported") tells the person nothing they can act on.
      setError(e instanceof ApiError && e.status === 0 ? e.message : "Email codes aren't available right now. Sign in with your password.");
    } finally {
      setLoading(false);
    }
  };

  const passkey = async () => {
    setError("");
    setLoading(true);
    try {
      await onSession(await signInWithPasskey());
    } catch (e) {
      if (!isPasskeyCancel(e)) setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  if (mode.kind === "code") {
    return (
      <AuthLayout
        subtitle={
          <>
            Enter the 6-digit code we sent to <Text style={[weight.semibold, { color: t.content }]}>{mode.req.email}</Text>.
          </>
        }
      >
        <CodeForm req={mode.req} onSession={onSession} onLeave={toSignIn} />
      </AuthLayout>
    );
  }

  if (mode.kind === "signup") {
    return (
      <AuthLayout
        footer={
          <View style={styles.toggle}>
            <Text style={[styles.toggleText, { color: t.contentSecondary }]}>Already have an account?</Text>
            <TextLink title="Sign in" onPress={toSignIn} />
          </View>
        }
      >
        <SignUpForm
          initialEmail={email.trim()}
          focusName={mode.handedOff}
          onSession={onSession}
          onVerify={(v) => setMode({ kind: "code", req: { purpose: "signup", ...v } })}
        />
      </AuthLayout>
    );
  }

  const emailError = /^(Email is required|Enter a valid email)/.test(error) ? error : null;
  const passwordError = step === "password" && error === "Password is required" ? error : null;
  // Every error reads in the one banner above the button (as on every auth screen). The field it is about is outlined.
  const bannerError = error || null;

  return (
    <AuthLayout
      subtitle="Welcome back. Let's check on your money."
      footer={
        <View style={styles.toggle}>
          <Text style={[styles.toggleText, { color: t.contentSecondary }]}>Don't have an account?</Text>
          <TextLink title="Sign up" onPress={() => toSignUp(false)} />
        </View>
      }
    >
      <TextField
        label="Email"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (error) setError("");
        }}
        autoFocus={step === "email"}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        returnKeyType={step === "email" ? "go" : "next"}
        onSubmitEditing={step === "email" ? submit : undefined}
        invalid={!!emailError}
      />
      {step === "password" ? (
        <TextField
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (error) setError("");
          }}
          autoFocus
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={submit}
          invalid={!!passwordError}
        />
      ) : null}
      {bannerError ? <Banner>{bannerError}</Banner> : null}
      <Button title={step === "password" ? "Sign in" : "Continue"} onPress={submit} loading={loading} />
      {step === "password" ? (
        <View style={styles.helpers}>
          <TextLink title="Forgot password?" onPress={() => router.push({ pathname: "/forgot-password", params: { email: email.trim() } })} />
          <TextLink title="Email a code instead" onPress={() => void emailACode()} disabled={loading} />
        </View>
      ) : passkeyReady ? (
        <>
          <OrDivider />
          <Button title="Sign in with Face ID" variant="secondary" icon="faceid" iconLeading disabled={loading} onPress={() => void passkey()} />
        </>
      ) : null}
    </AuthLayout>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  helpers: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleText: { ...type.subhead },
}));
