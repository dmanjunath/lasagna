import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Section } from "../components/common/section";

export function Settings() {
  const { user, tenant, updateTenant } = useAuth();

  // Profile form
  const [name, setName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (tenant?.name) {
      setName(tenant.name);
    }
  }, [tenant?.name]);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileError("");
    setProfileSuccess(false);
    try {
      const { profile } = await api.updateProfile({ name });
      if (profile.name) {
        updateTenant({ name: profile.name });
      }
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    setPasswordLoading(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">
          Settings
        </h1>
        <p className="text-text-muted mt-2">
          Manage your profile and account preferences
        </p>
      </motion.div>

      <div className="max-w-xl space-y-8">
        {/* Profile Section */}
        <Section title="Profile">
          <form onSubmit={handleProfileSave} className="glass-card rounded-2xl p-5 md:p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={user?.email || ""}
                disabled
                className="w-full px-4 py-3 bg-surface/50 rounded-xl border border-border text-text-muted cursor-not-allowed"
              />
              <p className="text-xs text-text-muted mt-1">Email cannot be changed</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Plan
              </label>
              <div className="px-4 py-3 bg-surface/50 rounded-xl border border-border text-text-muted capitalize">
                {tenant?.plan || "free"}
              </div>
            </div>

            {profileError && (
              <div className="flex items-center gap-2 text-danger text-sm">
                <AlertCircle className="w-4 h-4" />
                {profileError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={profileLoading}>
                {profileLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </span>
                ) : profileSuccess ? (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Saved
                  </span>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </form>
        </Section>

        {/* Change Password Section */}
        <Section title="Change Password">
          <form onSubmit={handlePasswordChange} className="glass-card rounded-2xl p-5 md:p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Current Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20 transition-all"
              />
            </div>

            {passwordError && (
              <div className="flex items-center gap-2 text-danger text-sm">
                <AlertCircle className="w-4 h-4" />
                {passwordError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={passwordLoading}>
                {passwordLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Changing...
                  </span>
                ) : passwordSuccess ? (
                  <span className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Changed
                  </span>
                ) : (
                  "Change Password"
                )}
              </Button>
            </div>
          </form>
        </Section>
      </div>
    </div>
  );
}
