import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/auth.js";
import { Button } from "../components/ui/button.js";
import { Logo } from "../components/common/Logo.js";

export function Login() {
  const { login, signup } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const autofillDemo = () => {
    setEmail("demo@lasagnafi.com");
    setPassword("lasagna123");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isSignup) {
        await signup(email, password, name || undefined);
      } else {
        await login(email, password);
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
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      {/* Ambient background glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/3 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md"
      >
        <div className="glass-card p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center mb-4">
              <Logo width={64} />
            </div>
            <h1 className="text-3xl font-display font-semibold text-text">
              Lasagna<em style={{ fontStyle: 'italic', color: 'var(--lf-sauce)' }}>Fi</em>
            </h1>
            <p className="text-text-secondary mt-1">Personal finance, layered.</p>
          </div>

          {import.meta.env.VITE_DEMO_MODE === "true" && (
            <div className="mb-4 rounded-lg p-3 text-sm" style={{
              border: '1px solid rgba(201,84,58,0.25)',
              background: 'rgba(201,84,58,0.06)',
            }}>
              <p className="font-semibold mb-1" style={{ color: 'var(--lf-sauce)' }}>
                Demo account
              </p>
              <p style={{ color: 'var(--lf-ink-soft)' }}>
                Email: demo@lasagnafi.com &nbsp;|&nbsp; Password: lasagna123
              </p>
              <button
                type="button"
                onClick={autofillDemo}
                className="mt-2 text-xs underline"
                style={{ color: 'var(--lf-sauce)' }}
              >
                Auto-fill credentials
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
                />
              </motion.div>
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
            />

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-danger/10 border border-danger/20"
              >
                <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                <span className="text-danger text-sm">{error}</span>
              </motion.div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </span>
              ) : isSignup ? "Create Account" : "Sign In"}
            </Button>
          </form>

          {/* Sign-up toggle button — hide in demo mode */}
          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <p className="text-center text-text-secondary mt-6">
              {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setIsSignup(!isSignup);
                  setError("");
                }}
                className="text-accent hover:text-accent-dim transition-colors font-medium"
              >
                {isSignup ? "Sign in" : "Sign up"}
              </button>
            </p>
          )}

          {/* If in demo mode, redirect to app.lasagnafi.com instead */}
          {import.meta.env.VITE_DEMO_MODE === "true" && (
            <p className="text-center text-sm text-[rgb(var(--color-text-secondary))] mt-6">
              <a href="https://app.lasagnafi.com/login" className="text-[rgb(var(--color-accent))] underline">
                Create an account at app.lasagnafi.com →
              </a>
            </p>
          )}
        </div>

        {/* Try the demo link — shown only when not in demo mode */}
        {import.meta.env.VITE_DEMO_MODE !== "true" && (
          <p className="text-center text-xs text-[rgb(var(--color-text-muted))] mt-3">
            Want to explore first?{" "}
            <a
              href="https://demo.lasagnafi.com"
              className="text-[rgb(var(--color-text-secondary))] underline"
            >
              Try the demo →
            </a>
          </p>
        )}

        {/* Decorative border glow */}
        <div className="absolute -inset-px rounded-2xl -z-10 blur-sm" style={{ background: 'linear-gradient(135deg, rgba(201,84,58,0.15), transparent, rgba(230,184,92,0.08))' }} />
      </motion.div>
    </div>
  );
}
