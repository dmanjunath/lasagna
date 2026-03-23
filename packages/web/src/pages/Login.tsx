import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
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
      setError(err instanceof Error ? err.message : "Something went wrong");
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
              <Logo size={64} />
            </div>
            <h1 className="text-3xl font-display font-semibold text-text">Lasagna</h1>
            <p className="text-text-muted mt-1">Personal finance platform</p>
          </div>

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
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-danger text-sm text-center py-2"
              >
                {error}
              </motion.p>
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

          <p className="text-center text-text-muted mt-6">
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
        </div>

        {/* Decorative border glow */}
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-accent/20 via-transparent to-accent/10 -z-10 blur-sm" />
      </motion.div>
    </div>
  );
}
