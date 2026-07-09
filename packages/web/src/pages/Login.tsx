import { useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Fingerprint } from "lucide-react";
import { useAuth } from "../lib/auth.js";
import { api, API_BASE } from "../lib/api.js";
import { isNativeApp } from "../lib/native.js";
import { Button, Input, Field } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";
import { GoogleButton } from "../components/common/GoogleButton";
import { ConsentCheckboxes } from "../components/common/ConsentCheckboxes";

export function Login() {
  const isDemo = import.meta.env.VITE_DEMO_MODE === "true";
  const { login, loginWithPasskey, signup } = useAuth();
  const [, navigate] = useLocation();
  const [isSignup, setIsSignup] = useState(false);
  // Two-step login: "email" collects the address, "password" appears only when the
  // account has one. Passwordless accounts go straight to the emailed-code screen.
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false); // signup: reveal optional password
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTos, setAcceptedTos] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedNotRia, setAcceptedNotRia] = useState(false);

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
      if (next === "password") setStep("password");
      else goToCodeScreen("login");
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  // Password sign-in (login password step, or demo combined form).
  const handlePasswordLogin = async () => {
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
    if (!consentOk) {
      setError("Please accept all agreements before creating an account.");
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
    if (isSignup) return handleSignup();
    if (isDemo || step === "password") return handlePasswordLogin();
    return handleEmailContinue();
  };

  const resetToLoginEmail = () => {
    setStep("email");
    setPassword("");
    setError("");
  };

  const toggleSignup = () => {
    setIsSignup((v) => !v);
    setError("");
    setPassword("");
    setShowPassword(false);
    setStep("email");
    setAcceptedTos(false);
    setAcceptedPrivacy(false);
    setAcceptedNotRia(false);
  };

  // Password field is visible in: demo, login password step, and signup (when revealed).
  const passwordVisible = isDemo || (!isSignup && step === "password") || (isSignup && showPassword);
  // Google + passkey belong on the "entry" screen: signup, or login before a password is asked for.
  const showSocial = !isDemo && (isSignup || step === "email");

  const submitLabel = loading
    ? "Processing…"
    : isSignup
    ? "Create Account"
    : isDemo || step === "password"
    ? "Sign In"
    : "Continue";

  return (
    <div className="ui-root min-h-dvh bg-canvas flex items-center justify-center p-4">
      {/* Ambient warm glow — faint, single brand accent for atmosphere. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[640px] h-[640px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, var(--ui-brand-soft), transparent 68%)" }}
        />
      </div>

      <div className="relative w-full max-w-[420px]">
        <div className="rounded-ui-xl border border-line bg-panel shadow-ui-lg p-5 sm:p-8">
          {/* Brand + welcome — compact row on phones so the card fits one screen */}
          <div className="flex flex-col items-center text-center mb-3.5 sm:mb-7">
            <div className="flex items-center gap-2 sm:flex-col sm:gap-0">
              <BrandMark size={34} />
              <h1 className="font-editorial text-[22px] sm:mt-4 sm:text-[26px] font-medium tracking-[-0.015em] text-content">
                Lasagna<span className="text-brand">Fi</span>
              </h1>
            </div>
            <p className="mt-1 text-[13.5px] sm:text-[14px] text-content-secondary">
              {isSignup ? "Create your account — personal finance, layered." : "Welcome back — let's check on your money."}
            </p>
          </div>

          {isDemo && (
            <div className="mb-5 rounded-ui-md border border-brand-soft bg-brand-softer p-3.5 text-sm">
              <p className="font-semibold text-brand mb-1">Demo account</p>
              <p className="text-content-secondary ui-tnum">
                demo@lasagnafi.com &nbsp;·&nbsp; lasagna123
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

          <form onSubmit={handleSubmit} className="space-y-3">
            {isSignup && (
              <Field label="Name" hint="Optional">
                <Input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </Field>
            )}

            <Field label="Email">
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                // On the login password step the email is locked in; edit via the link below.
                readOnly={!isSignup && !isDemo && step === "password"}
              />
            </Field>

            {/* "Use a different email" — login password step only */}
            {!isSignup && !isDemo && step === "password" && (
              <button
                type="button"
                onClick={resetToLoginEmail}
                className="-mt-1.5 text-xs text-content-secondary hover:text-content underline underline-offset-2"
              >
                Use a different email
              </button>
            )}

            {/* Signup: optional password is hidden behind a toggle */}
            {isSignup && !showPassword && (
              <button
                type="button"
                onClick={() => setShowPassword(true)}
                className="text-sm text-brand hover:text-brand-hover underline underline-offset-2"
              >
                Set a password (optional)
              </button>
            )}

            {passwordVisible && (
              <Field label="Password" hint={isSignup ? "Optional · at least 10 characters" : undefined}>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={!isSignup}
                  minLength={isSignup ? 10 : 6}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  autoFocus={!isSignup && !isDemo}
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

            {error && (
              <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-ui-md bg-negative-soft border border-negative/25">
                <AlertCircle className="w-4 h-4 text-negative flex-shrink-0" />
                <span className="text-negative text-sm">{error}</span>
              </div>
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
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="text-sm text-content-secondary hover:text-content underline underline-offset-2"
              >
                Forgot password?
              </button>
              {!isDemo && (
                <button
                  type="button"
                  onClick={handleEmailACode}
                  disabled={loading}
                  className="text-sm text-brand hover:text-brand-hover underline underline-offset-2"
                >
                  Email a code instead ↩
                </button>
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
              {!isNativeApp() && (
                <GoogleButton
                  label={isSignup ? "Sign up with Google" : "Continue with Google"}
                  disabled={isSignup && !consentOk}
                  onClick={() => window.location.assign(`${API_BASE}/api/auth/google/start`)}
                />
              )}
              {/* Passkey sign-in is app-only: the shell pairs it with Face ID.
                  On mobile web the password + iCloud autofill flow covers it. */}
              {!isSignup && isNativeApp() && typeof window !== "undefined" && !!window.PublicKeyCredential && (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full mt-3"
                  disabled={loading}
                  onClick={handlePasskey}
                >
                  <Fingerprint className="h-4 w-4" />
                  Sign in with Face ID / passkey
                </Button>
              )}
            </>
          )}

          {/* Sign-up toggle button — hide in demo mode */}
          {!isDemo && (
            <p className="text-center text-content-secondary text-sm mt-4 sm:mt-6">
              {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                type="button"
                onClick={toggleSignup}
                className="text-brand hover:text-brand-hover transition-colors font-medium"
              >
                {isSignup ? "Sign in" : "Sign up"}
              </button>
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
