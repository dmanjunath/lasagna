import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Input, Field } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
        <div className="rounded-ui-xl border border-line bg-panel shadow-ui-lg p-7 sm:p-8">
          <div className="flex flex-col items-center text-center mb-7">
            <BrandMark size={54} />
            <h1 className="mt-4 font-editorial text-[26px] font-medium tracking-[-0.015em] text-content">
              Reset your password
            </h1>
            <p className="mt-1.5 text-[14px] text-content-secondary">
              {sent
                ? "Check your inbox for the next step."
                : "Enter your email and we'll send you a reset link."}
            </p>
          </div>

          {sent ? (
            <>
              <div className="rounded-ui-md border border-line bg-canvas-sunken p-4 text-sm text-content-secondary leading-relaxed">
                If an account exists for that email, we've sent a password reset link.
              </div>
              <p className="text-center mt-5">
                <a
                  href="/"
                  className="text-sm text-brand hover:text-brand-hover underline underline-offset-2"
                >
                  Back to sign in
                </a>
              </p>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <Field label="Email">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </Field>

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
                disabled={loading || !email}
                className="w-full"
              >
                {loading ? "Sending…" : "Send reset link"}
              </Button>

              <p className="text-center pt-1">
                <a
                  href="/"
                  className="text-sm text-content-secondary hover:text-content underline underline-offset-2"
                >
                  Back to sign in
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
