import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ScanFace } from "lucide-react";
import { useAuth } from "../lib/auth.js";
import { api, API_BASE } from "../lib/api.js";
import { isNativeApp } from "../lib/native.js";
import { hasRegisteredPasskey } from "../lib/passkey-hint.js";
import { Button, Input, Field, Alert, TextLink } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";
import { GoogleButton } from "../components/common/GoogleButton";
import { ConsentCheckboxes } from "../components/common/ConsentCheckboxes";

export function Login({ defaultSignup = false, requireName = false }: { defaultSignup?: boolean; requireName?: boolean } = {}) {
  const isDemo = import.meta.env.VITE_DEMO_MODE === "true";
  const { login, loginWithPasskey, signup } = useAuth();
  const [, navigate] = useLocation();
  const [isSignup, setIsSignup] = useState(defaultSignup);
  // Set when sign-in found no account and switched to signup, so focus lands
  // on the first field rather than dropping to the page.
  const [handedOff, setHandedOff] = useState(false);
  // App keeps this mounted across /login and /signup, so Back after the
  // no-account handoff changes the URL but not the form. Follow the URL.
  const [urlSignup, setUrlSignup] = useState(defaultSignup);
  if (defaultSignup !== urlSignup) {
    setUrlSignup(defaultSignup);
    setIsSignup(defaultSignup);
    if (!defaultSignup) setHandedOff(false);
  }
  // Two-step login: "email" collects the address, "password" appears only when the
  // account has one. Passwordless accounts go straight to the emailed-code screen.
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  // The address /login/start last answered "password" for. The email stays
  // editable on the password step, so a change sends it back through that check.
  const [checkedEmail, setCheckedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false); // signup: reveal optional password
  // Local auth mode requires a signup password while WorkOS mode does not.
  // The server says which on mount (null until it answers).
  const [serverPasswordRequired, setServerPasswordRequired] = useState<boolean | null>(null);
  // Set when the server rejects a signup for a missing password, in case the
  // /signup/options request failed, rather than leaving "optional" on screen
  // next to "required".
  const [learnedPasswordRequired, setPasswordRequired] = useState(false);
  const passwordRequired = serverPasswordRequired === true || learnedPasswordRequired;
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTos, setAcceptedTos] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedNotRia, setAcceptedNotRia] = useState(false);

  useEffect(() => {
    if (isDemo) return;
    api.signupOptions()
      .then((o) => setServerPasswordRequired(o.passwordRequired))
      .catch(() => setServerPasswordRequired(false));
  }, [isDemo]);

  const consentOk = acceptedTos && acceptedPrivacy && acceptedNotRia;

  const autofillDemo = () => {
    setEmail("demo@lasagnafi.com");
    setPassword("lasagna123");
  };

  const showError = (err: unknown) => {
    if (err instanceof TypeError && err.message.includes("fetch")) {
      setError("Cannot reach the server. Please check your connection.");
    } else if (err instanceof Error) {
      setError(err.message);
      // An error that names the password is unreadable while the field is still
      // collapsed behind "Set a password (optional)": the user is told a field
      // is required and cannot see it. Reveal it and put the cursor in it.
      if (/password/i.test(err.message)) { setPasswordRequired(true); setShowPassword(true); }
    } else {
      setError("Something went wrong. Please try again.");
    }
  };

  const goToCodeScreen = (purpose: "login" | "signup", extra: Record<string, unknown> = {}) => {
    sessionStorage.setItem("lf_verify", JSON.stringify({ purpose, email, ...extra }));
    navigate("/verify-email");
  };

  const handlePasskey = async () => {
    setError("");
    setLoading(true);
    try {
      await loginWithPasskey();
      navigate("/");
    } catch (err) {
      // NotAllowedError = the user dismissed the Face ID / passkey prompt.
      if (err instanceof Error && err.name !== "NotAllowedError") setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 1 of two-step login: decide password vs emailed code.
  const handleEmailContinue = async () => {
    setLoading(true);
    try {
      const { step: next } = await api.loginStart(email);
      if (next === "code") return goToCodeScreen("login");
      // No account for this email: carry it over to signup.
      if (next === "signup") {
        setHandedOff(true);
        // Pushed, not replaced: Back returns to sign-in after a mistyped email.
        return toggleSignup(false);
      }
      setCheckedEmail(email);
      setStep("password");
      // The email was edited on the password step, so carry on signing in
      // rather than asking for another click (an empty password errors there).
      if (step === "password") await handlePasswordLogin();
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  // Password sign-in (login password step, or demo combined form).
  const handlePasswordLogin = async () => {
    if (!password) {
      setError("Password is required");
      return;
    }
    setLoading(true);
    try {
      const res = await login(email, password);
      // WorkOS reports the email isn't verified yet → finish on the code screen.
      if (res) goToCodeScreen("login");
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  // "Email a code instead" from the password step.
  const handleEmailACode = async () => {
    setError("");
    setLoading(true);
    try {
      await api.loginSendCode(email);
      goToCodeScreen("login");
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    if (requireName && !name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!consentOk) {
      setError("Please accept all agreements before creating an account.");
      return;
    }
    // The server told us once already that this deployment needs a password.
    if (passwordRequired && !password) {
      setError("Password is required");
      setShowPassword(true);
      return;
    }
    if (password && password.length < 10) {
      setError("Password must be at least 10 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await signup(email, password, name || undefined, { acceptedTos, acceptedPrivacy, acceptedNotRia });
      // WorkOS mode → verify by code (carry consent + whether a password was set).
      if (res) goToCodeScreen("signup", { setPassword: Boolean(password), acceptedTos, acceptedPrivacy, acceptedNotRia });
      // Local mode signs in directly (res === null); the app redirects.
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    // The browser used to do this. noValidate turned it off for every field at
    // once, and the server does not check the format either: normalizeEmail only
    // trims and lowercases, so "abc" was accepted as an address.
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }
    if (isSignup) return handleSignup();
    if (isDemo || (step === "password" && email === checkedEmail)) return handlePasswordLogin();
    return handleEmailContinue();
  };

  const toggleSignup = (replace = true) => {
    // Keep the address bar honest. Without this, switching to sign-in on
    // /signup leaves the URL saying signup, and a reload throws the user back
    // onto the form they just left. Outside the updater: StrictMode may call
    // that twice, and navigation is not something to do twice.
    navigate(isSignup ? "/" : "/signup", { replace });
    setIsSignup((v) => !v);
    setError("");
    setPassword("");
    setShowPassword(false);
    setPasswordRequired(false);
    setStep("email");
    setAcceptedTos(false);
    setAcceptedPrivacy(false);
    setAcceptedNotRia(false);
  };

  // Password field is visible in: demo, login password step, and signup (when revealed).
  const passwordVisible = isDemo || (!isSignup && step === "password") || (isSignup && (showPassword || passwordRequired));
  // Google + passkey belong on the "entry" screen: signup, or login before a password is asked for.
  // Google is web-only (its redirect needs a system browser) and the passkey
  // button needs a passkey already on this device, so in a fresh install both
  // are hidden. Track each one, or the "or" divider renders separating nothing.
  const showGoogle = !isNativeApp();
  const showPasskey =
    !isSignup &&
    isNativeApp() &&
    typeof window !== "undefined" &&
    !!window.PublicKeyCredential &&
    hasRegisteredPasskey();
  const showSocial = !isDemo && (isSignup || step === "email") && (showGoogle || showPasskey);

  // An error belonging to a field: the field shows it and paints itself invalid,
  // and the banner below stays quiet rather than saying the same sentence twice.
  // Gated on passwordVisible, not showPassword, because the latter is a
  // signup-only reveal flag and this has to work on the login step too.
  const passwordFieldError =
    passwordVisible && /^Password (is required|must be)/.test(error) ? error : undefined;
  const emailFieldError = /^(Email is required|Enter a valid email)/.test(error) ? error : undefined;

  const submitLabel = loading
    ? "Processing…"
    : isSignup
    ? "Create Account"
    : isDemo || step === "password"
    ? "Sign in"
    : "Continue";

  return (
    <div className="ui-root min-h-dvh bg-canvas flex items-start justify-center p-4 pt-24 sm:items-center sm:pt-4">
      {/* Ambient warm glow — faint, single brand accent for atmosphere. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, var(--ui-brand-soft), transparent 68%)" }}
        />
      </div>

      <div className="relative w-full max-w-[420px]">
        <div className="p-5 sm:rounded-ui-xl sm:border sm:border-line sm:bg-panel sm:shadow-ui-lg sm:p-8">
          {/* Brand + welcome — compact row on phones so the card fits one screen */}
          <div className="flex flex-col items-center text-center mb-3.5 sm:mb-7">
            <div className="flex items-center gap-2 sm:flex-col sm:gap-0">
              <BrandMark size={34} />
              <h1 className="font-editorial text-[22px] sm:mt-4 sm:text-[26px] font-medium tracking-[-0.015em] text-content">
                Lasagna<span className="text-brand">Fi</span>
              </h1>
            </div>
            {/* Signup carries no subtitle, and renders none rather than an
                empty one that still takes its line box. Everything it could say
                is already said by the fields and the button, and most people
                arrive here straight off the marketing site, which has just
                explained the product. "Welcome back" is true only of login. */}
            {!isSignup && (
              <p className="mt-1 text-[13.5px] sm:text-[14px] text-content-secondary">
                Welcome back. Let's check on your money.
              </p>
            )}
          </div>

          {isDemo && (
            <div className="mb-5 rounded-ui-md border border-brand-soft bg-brand-softer p-3.5 text-sm">
              <p className="font-semibold text-brand mb-1">Demo account</p>
              <p className="flex flex-wrap gap-x-4 text-content-secondary ui-tnum">
                <span>demo@lasagnafi.com</span>
                <span>lasagna123</span>
              </p>
              <button
                type="button"
                onClick={autofillDemo}
                className="mt-2 text-xs font-medium text-brand underline underline-offset-2 hover:text-brand-hover"
              >
                Auto-fill credentials
              </button>
            </div>
          )}

          {/* noValidate: every check below reports through the styled Field and
              banner. Left on, the browser speaks too, in its own chrome and its
              own words, over the top of ours. */}
          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            {isSignup && (
              <Field label="Name" hint={requireName ? undefined : "Optional"}>
                <Input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                autoFocus={handedOff}
                />
              </Field>
            )}

            <Field label="Email" error={emailFieldError} alert>
              <Input
                type="email"
                enterKeyHint="go"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(""); }}
                invalid={!!emailFieldError}
                autoComplete="email"
              />
            </Field>

            {/* Signup: optional password is hidden behind a toggle */}
            {/* Held invisible while the server has not said whether a password
                is required, so the optional case (prod) never shifts. */}
            {isSignup && !showPassword && !passwordRequired && (
              <button
                type="button"
                onClick={() => setShowPassword(true)}
                disabled={serverPasswordRequired === null}
                aria-hidden={serverPasswordRequired === null || undefined}
                className={`${serverPasswordRequired === null ? "invisible " : ""}ui-focus inline-flex min-h-touch items-center rounded-ui-sm py-2 text-sm text-brand hover:text-brand-hover underline underline-offset-2`}
              >
                Set a password (optional)
              </button>
            )}

            {passwordVisible && (
              <Field
                label="Password"
                // Field renders this inline, sets aria-invalid and wires
                // aria-describedby, so the message sits on the control it names
                // rather than in a banner below three checkboxes. `alert`
                // because this form validates on submit, with focus on the
                // button, so describedby alone would never be read out.
                error={passwordFieldError}
                alert
                hint={
                  isSignup
                    ? passwordRequired
                      ? "At least 10 characters"
                      : "Optional, at least 10 characters"
                    : undefined
                }
              >
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
                  invalid={!!passwordFieldError}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  // Mounts the moment signup reveals the field, so this lands the
                  // cursor in it whether the user opened it or an error did.
                  autoFocus={(!isSignup && !isDemo) || (isSignup && showPassword)}
                />
              </Field>
            )}

            {isSignup && (
              <ConsentCheckboxes
                values={{ acceptedTos, acceptedPrivacy, acceptedNotRia }}
                onChange={(key, checked) => {
                  if (key === "acceptedTos") setAcceptedTos(checked);
                  else if (key === "acceptedPrivacy") setAcceptedPrivacy(checked);
                  else setAcceptedNotRia(checked);
                }}
              />
            )}

            {error && error !== passwordFieldError && error !== emailFieldError && (
              // Submitting can move focus to the field an error names, so the
              // Alert's live region is what tells a screen reader what went wrong.
              <Alert tone="negative">{error}</Alert>
            )}

            <Button
              type="submit"
              size="lg"
              loading={loading}
              disabled={loading || (isSignup && !consentOk)}
              className="w-full"
            >
              {submitLabel}
            </Button>
          </form>

          {/* Login helpers — password step (and demo) */}
          {!isSignup && (isDemo || step === "password") && (
            <div className="flex items-center justify-between mt-2.5">
              <TextLink href="/forgot-password" chevron={false}>Forgot password?</TextLink>
              {!isDemo && (
                <TextLink onClick={handleEmailACode} chevron={false}>Email a code instead</TextLink>
              )}
            </div>
          )}

          {/* Social sign-in — hidden in demo mode and on the login password step */}
          {showSocial && (
            <>
              <div className="flex items-center gap-3 my-3.5 sm:my-5">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs text-content-muted">or</span>
                <div className="h-px flex-1 bg-line" />
              </div>
              {/* Google OAuth is a full-page redirect — needs a system-browser
                  flow in the native shell, so it's web-only for now. */}
              {showGoogle && (
                <GoogleButton
                  label={isSignup ? "Sign up with Google" : "Continue with Google"}
                  disabled={isSignup && !consentOk}
                  onClick={() => window.location.assign(`${API_BASE}/api/auth/google/start`)}
                />
              )}
              {/* Passkey sign-in is app-only: the shell pairs it with Face ID.
                  Shown only once a passkey has been registered on this device
                  (hasRegisteredPasskey) — a fresh install has none to use yet.
                  On mobile web the password + iCloud autofill flow covers it. */}
              {showPasskey && (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full mt-3"
                  disabled={loading}
                  onClick={handlePasskey}
                >
                  <ScanFace className="h-4 w-4" />
                  Sign in with Face ID
                </Button>
              )}
            </>
          )}

          {/* Sign-up toggle button — hide in demo mode */}
          {!isDemo && (
            <p className="text-center text-content-secondary text-sm mt-4 sm:mt-6">
              {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
              <TextLink onClick={() => toggleSignup()} chevron={false}>{isSignup ? "Sign in" : "Sign up"}</TextLink>
            </p>
          )}

          {/* If in demo mode, redirect to app.lasagnafi.com instead */}
          {isDemo && (
            <p className="text-center text-sm text-content-secondary mt-6">
              <a href="https://app.lasagnafi.com/login" className="text-brand hover:text-brand-hover underline underline-offset-2">
                Create an account at app.lasagnafi.com →
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
