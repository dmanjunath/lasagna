import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { Button, Input, Field } from "../components/uikit";
import { BrandMark } from "../components/common/BrandMark";

function readToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

export function ResetPassword() {
  const [token] = useState<string | null>(readToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError("");
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
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
              {done ? "Password updated" : "Choose a new password"}
            </h1>
            {done && (
              <p className="mt-1.5 text-[14px] text-content-secondary">
                Your password has been updated.
              </p>
            )}
          </div>

          {!token ? (
            <>
              <div className="rounded-ui-md border border-line bg-canvas-sunken p-4 text-sm text-content-secondary leading-relaxed">
                This reset link is invalid.
              </div>
              <p className="text-center mt-5">
                <a
                  href="/forgot-password"
                  className="text-sm text-brand hover:text-brand-hover underline underline-offset-2"
                >
                  Request a new link
                </a>
              </p>
            </>
          ) : done ? (
            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={() => window.location.assign("/")}
            >
              Continue to sign in
            </Button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <Field label="New password" hint="At least 10 characters">
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={10}
                  autoComplete="new-password"
                  autoFocus
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={10}
                  autoComplete="new-password"
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
                disabled={loading || !password || !confirm}
                className="w-full"
              >
                {loading ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
