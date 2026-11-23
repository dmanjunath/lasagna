import { useEffect, useState } from "react";
import { authApi, type Session } from "@/api/auth";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { allConsented, Banner, ConsentCheckboxes, errorText, isEmail, NO_CONSENT, TextLink, type ConsentValues } from "./AuthKit";

const TOO_SHORT = "Password must be at least 10 characters";

export type SignupVerify = { email: string; setPassword: boolean; consents: ConsentValues };

/**
 * The create-account form of packages/web/src/pages/Login.tsx: name (optional
 * unless an invite needs it), email, a password behind "Set a password
 * (optional)" unless this deployment requires one, and the three agreements.
 * A deployment that verifies by code hands off to `onVerify`; local mode signs
 * in directly through `onSession`.
 */
export function SignUpForm({
  initialEmail = "",
  requireName = false,
  focusName = false,
  onSession,
  onVerify,
}: {
  initialEmail?: string;
  requireName?: boolean;
  focusName?: boolean;
  onSession: (s: Session) => Promise<void>;
  onVerify: (v: SignupVerify) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // The server says on mount whether this deployment needs a password (null until it answers).
  const [serverRequired, setServerRequired] = useState<boolean | null>(null);
  // Learned from a rejection, in case the options call failed.
  const [learnedRequired, setLearnedRequired] = useState(false);
  const passwordRequired = serverRequired === true || learnedRequired;
  const [consents, setConsents] = useState<ConsentValues>(NO_CONSENT);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authApi
      .signupOptions()
      .then((o) => setServerRequired(o.passwordRequired))
      .catch(() => setServerRequired(false));
  }, []);

  const consentOk = allConsented(consents);
  const passwordVisible = showPassword || passwordRequired;

  const submit = async () => {
    setError("");
    if (!email.trim()) return setError("Email is required");
    if (!isEmail(email)) return setError("Enter a valid email address");
    if (requireName && !name.trim()) return setError("Please enter your name.");
    if (!consentOk) return setError("Please accept all agreements before creating an account.");
    if (passwordRequired && !password) {
      setShowPassword(true);
      return setError("Password is required");
    }
    if (password && password.length < 10) return setError(TOO_SHORT);
    setLoading(true);
    try {
      const res = await authApi.signup({ email: email.trim(), password, name: name.trim() || undefined, ...consents });
      if ("needsVerification" in res) onVerify({ email: res.email || email.trim(), setPassword: Boolean(password), consents });
      else await onSession(res);
    } catch (e) {
      const msg = errorText(e);
      setError(msg);
      // An error naming the password is unreadable while the field is still hidden.
      if (/password/i.test(msg)) {
        setLearnedRequired(true);
        setShowPassword(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const emailError = /^(Email is required|Enter a valid email)/.test(error) ? error : null;
  const nameError = error === "Please enter your name." ? error : null;
  const passwordError = passwordVisible && /^Password (is required|must be)/.test(error) ? error : null;
  // Every error reads in the one banner above the button (as on every auth
  // screen). The field it is about is outlined.
  const bannerError = error || null;

  return (
    <>
      <TextField
        label="Name"
        hint={requireName ? undefined : "Optional"}
        value={name}
        onChangeText={setName}
        autoFocus={focusName}
        autoCapitalize="words"
        textContentType="name"
        autoComplete="name"
        returnKeyType="next"
        invalid={!!nameError}
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (error) setError("");
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        returnKeyType="next"
        invalid={!!emailError}
      />
      {passwordVisible ? (
        <TextField
          label="Password"
          hint={passwordRequired ? "At least 10 characters" : "Optional, at least 10 characters"}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (error) setError("");
          }}
          autoFocus={showPassword}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          returnKeyType="done"
          invalid={!!passwordError}
        />
      ) : serverRequired === false ? (
        // Held back until the server has answered, so the required case never shows "optional".
        <TextLink title="Set a password (optional)" onPress={() => setShowPassword(true)} />
      ) : null}
      <ConsentCheckboxes values={consents} onChange={setConsents} />
      {bannerError ? <Banner>{bannerError}</Banner> : null}
      <Button title="Create account" onPress={() => void submit()} loading={loading} disabled={!consentOk} />
    </>
  );
}
