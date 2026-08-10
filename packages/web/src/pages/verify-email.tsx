import { useState } from "react";
import { useLocation } from "wouter";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { setNativeToken } from "../lib/native.js";
import { Button, Input, Field } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";
import { ConsentCheckboxes } from "../components/common/ConsentCheckboxes";

type VerifyStash = {
  purpose: "login" | "signup";
  email: string;
  setPassword?: boolean;
  acceptedTos?: boolean;
  acceptedPrivacy?: boolean;
  acceptedNotRia?: boolean;
};

function readStash(): VerifyStash | null {
  try {
    const raw = sessionStorage.getItem("lf_verify");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerifyStash;
    if (!parsed.email || (parsed.purpose !== "login" && parsed.purpose !== "signup")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function VerifyEmail() {
  const [, navigate] = useLocation();
  const [stash] = useState<VerifyStash | null>(readStash);
  const isSignup = stash?.purpose === "signup";
  const [code, setCode] = useState("");
  const [acceptedTos, setAcceptedTos] = useState(stash?.acceptedTos ?? false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(stash?.acceptedPrivacy ?? false);
  const [acceptedNotRia, setAcceptedNotRia] = useState(stash?.acceptedNotRia ?? false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);

  // Consent is captured on the signup page and carried in the stash. Only surface the
  // checkboxes for a signup that somehow arrived without them. Login never asks for consent.
  const consentCaptured = Boolean(stash?.acceptedTos && stash?.acceptedPrivacy && stash?.acceptedNotRia);
  const needConsentUi = isSignup && !consentCaptured;
  const consentOk = !isSignup || (acceptedTos && acceptedPrivacy && acceptedNotRia);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stash) return;
    setError("");
    setLoading(true);
    try {
      const res =
        stash.purpose === "login"
          ? await api.loginCode(stash.email, code)
          : await api.verifyEmail({
              email: stash.email,
              code,
              setPassword: Boolean(stash.setPassword),
              acceptedTos,
              acceptedPrivacy,
              acceptedNotRia,
            });
      // Native shell (Capacitor): the httpOnly cookie doesn't survive, so persist the
      // Bearer token before reloading or /me runs unauthenticated and bounces to login.
      if (res?.token) setNativeToken(res.token);
      // Full reload so AuthProvider re-runs /me and picks up the new session cookie.
      sessionStorage.removeItem("lf_verify");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!stash) return;
    setError("");
    try {
      await api.loginSendCode(stash.email);
      setResent(true);
    } catch {
      /* no enumeration — stay quiet */
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
        <div className="rounded-ui-xl border border-line bg-panel shadow-ui-lg p-7 sm:p-8">
          <div className="flex flex-col items-center text-center mb-7">
            <BrandMark size={54} />
            <h1 className="mt-4 font-editorial text-[26px] font-medium tracking-[-0.015em] text-content">
              Lasagna<span className="text-brand">Fi</span>
            </h1>
            {stash ? (
              <p className="mt-1.5 text-[14px] text-content-secondary">
                Enter the 6-digit code we sent to{" "}
                <span className="font-medium text-content">{stash.email}</span>.
              </p>
            ) : (
              <p className="mt-1.5 text-[14px] text-content-secondary">
                Your sign-in session expired.
              </p>
            )}
          </div>

          {!stash ? (
            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={() => window.location.assign("/")}
            >
              Back to sign in
            </Button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <Field label="Verification code">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  autoFocus
                />
              </Field>

              {/* Signup only — and only if consent wasn't already captured on the signup page. */}
              {needConsentUi && (
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
                disabled={loading || !code || !consentOk}
                className="w-full"
              >
                {loading ? "Verifying…" : isSignup ? "Create account" : "Sign in"}
              </Button>

              <div className="flex items-center justify-between pt-0.5">
                <button
                  type="button"
                  onClick={resend}
                  className="text-sm text-brand hover:text-brand-hover underline underline-offset-2"
                >
                  {resent ? "Code re-sent ✓" : "Didn't get a code? Resend"}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="text-sm text-content-secondary hover:text-content underline underline-offset-2"
                >
                  {isSignup ? "Back to sign in" : "Need an account?"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
