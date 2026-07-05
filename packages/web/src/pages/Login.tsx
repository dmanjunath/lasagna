import { useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Fingerprint } from "lucide-react";
import { useAuth } from "../lib/auth.js";
import { API_BASE } from "../lib/api.js";
import { isNativeApp } from "../lib/native.js";
import { Button, Input, Field } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";
import { ConsentCheckboxes } from "../components/common/ConsentCheckboxes";

export function Login() {
  const { login, loginWithPasskey, signup } = useAuth();
  const [, navigate] = useLocation();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTos, setAcceptedTos] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedNotRia, setAcceptedNotRia] = useState(false);

  const autofillDemo = () => {
    setEmail("demo@lasagnafi.com");
    setPassword("lasagna123");
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (isSignup && (!acceptedTos || !acceptedPrivacy || !acceptedNotRia)) {
      setError("Please accept all agreements before creating an account.");
      return;
    }
    setLoading(true);
    try {
      if (isSignup) {
        const res = await signup(email, password, name || undefined, { acceptedTos, acceptedPrivacy, acceptedNotRia });
        if (res) { sessionStorage.setItem("lf_verify", JSON.stringify({ workosUserId: res.workosUserId, email: res.email, acceptedTos, acceptedPrivacy, acceptedNotRia })); navigate("/verify-email"); return; }
      } else {
        const res = await login(email, password);
        if (res) { sessionStorage.setItem("lf_verify", JSON.stringify({ workosUserId: res.workosUserId, email: res.email })); navigate("/verify-email"); return; }
      }
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("Cannot reach the server. Please check your connection.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

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

          {import.meta.env.VITE_DEMO_MODE === "true" && (
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
              />
            </Field>
            <Field label="Password" hint={isSignup ? "At least 10 characters" : undefined}>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={isSignup ? 10 : 6}
                autoComplete={isSignup ? "new-password" : "current-password"}
              />
            </Field>

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
              disabled={loading || (isSignup && (!acceptedTos || !acceptedPrivacy || !acceptedNotRia))}
              className="w-full"
            >
              {loading ? "Processing…" : isSignup ? "Create Account" : "Sign In"}
            </Button>
          </form>

          {/* Forgot password — login view only */}
          {!isSignup && (
            <p className="text-center mt-2.5">
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                className="text-sm text-content-secondary hover:text-content underline underline-offset-2"
              >
                Forgot password?
              </button>
            </p>
          )}

          {/* Sign in / up with Google — hide in demo mode */}
          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <>
              <div className="flex items-center gap-3 my-3.5 sm:my-5">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs text-content-muted">or</span>
                <div className="h-px flex-1 bg-line" />
              </div>
              {/* Google OAuth is a full-page redirect — needs a system-browser
                  flow in the native shell, so it's web-only for now. */}
              {!isNativeApp() && (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  disabled={isSignup && (!acceptedTos || !acceptedPrivacy || !acceptedNotRia)}
                  onClick={() => window.location.assign(`${API_BASE}/api/auth/google/start`)}
                >
                  {isSignup ? "Sign up with Google" : "Sign in with Google"}
                </Button>
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
          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <p className="text-center text-content-secondary text-sm mt-4 sm:mt-6">
              {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setIsSignup(!isSignup);
                  setError("");
                  setAcceptedTos(false);
                  setAcceptedPrivacy(false);
                  setAcceptedNotRia(false);
                }}
                className="text-brand hover:text-brand-hover transition-colors font-medium"
              >
                {isSignup ? "Sign in" : "Sign up"}
              </button>
            </p>
          )}

          {/* If in demo mode, redirect to app.lasagnafi.com instead */}
          {import.meta.env.VITE_DEMO_MODE === "true" && (
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
