import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { Button } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";

export function WelcomeConsent() {
  const [acceptedTos, setAcceptedTos] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [acceptedNotRia, setAcceptedNotRia] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.acceptTerms();
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
              Welcome to Lasagna<span className="text-brand">Fi</span>
            </h1>
            <p className="mt-1.5 text-[14px] text-content-secondary">
              Before you continue, please review and accept the terms below.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
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
              disabled={loading || !acceptedTos || !acceptedPrivacy || !acceptedNotRia}
              className="w-full"
            >
              {loading ? "Saving…" : "Continue"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
