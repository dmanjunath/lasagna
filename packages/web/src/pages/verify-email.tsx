import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Input, Field } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";

type VerifyStash = {
  workosUserId: string;
  email: string;
  acceptedTos?: boolean;
  acceptedPrivacy?: boolean;
  acceptedNotRia?: boolean;
};

function readStash(): VerifyStash | null {
  try {
    const raw = sessionStorage.getItem("lf_verify");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerifyStash;
    if (!parsed.workosUserId || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function VerifyEmail() {
  const [stash] = useState<VerifyStash | null>(readStash);
  const [code, setCode] = useState("");
  const [acceptedTos, setAcceptedTos] = useState(stash?.acceptedTos ?? false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(stash?.acceptedPrivacy ?? false);
  const [acceptedNotRia, setAcceptedNotRia] = useState(stash?.acceptedNotRia ?? false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stash) return;
    setError("");
    setLoading(true);
    try {
      await api.verifyEmail({
        workosUserId: stash.workosUserId,
        code,
        acceptedTos,
        acceptedPrivacy,
        acceptedNotRia,
      });
      // Full reload so AuthProvider re-runs /me and picks up the new session cookie.
      sessionStorage.removeItem("lf_verify");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="ui-root min-h-screen bg-canvas flex items-center justify-center p-4">
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
                Your verification session expired.
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

              {/* Consent checkboxes — pre-checked from the signup stash, unchecked
                  for login-initiated verification. */}
              <div className="space-y-3 pt-1 text-sm">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTos}
                    onChange={(e) => setAcceptedTos(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]"
                  />
                  <span className="text-content-secondary leading-snug">
                    I agree to the{" "}
                    <a
                      href="https://lasagnafi.com/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:text-brand-hover underline underline-offset-2"
                    >
                      Terms of Service
                    </a>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedPrivacy}
                    onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]"
                  />
                  <span className="text-content-secondary leading-snug">
                    I agree to the{" "}
                    <a
                      href="https://lasagnafi.com/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:text-brand-hover underline underline-offset-2"
                    >
                      Privacy Policy
                    </a>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedNotRia}
                    onChange={(e) => setAcceptedNotRia(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]"
                  />
                  <span className="text-content-secondary leading-snug">
                    I understand that LasagnaFi is <strong className="font-semibold text-content">not a registered
                    investment advisor</strong> and does not provide financial advice
                  </span>
                </label>
              </div>

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
                disabled={loading || !acceptedTos || !acceptedPrivacy || !acceptedNotRia || !code}
                className="w-full"
              >
                {loading ? "Verifying…" : "Verify email"}
              </Button>

              {/* A "Resend code" affordance can be added here later if needed. */}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
