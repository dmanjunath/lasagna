import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useState, useEffect, useCallback } from "react";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

interface SettingsRowProps {
  icon: string;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}

function SettingsRow({ icon, label, danger, onClick }: SettingsRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between px-5 py-4 cursor-pointer hover:bg-surface-hover transition-colors text-left"
    >
      <div className="flex items-center gap-3.5">
        <div className="w-9 h-9 rounded-lg bg-bg-elevated flex items-center justify-center text-lg">
          {icon}
        </div>
        <span className={danger ? "text-danger font-medium" : "text-text"}>
          {label}
        </span>
      </div>
      <span className="text-sm text-text-muted">›</span>
    </button>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  valueClass?: string;
}

function StatRow({ label, value, valueClass }: StatRowProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm font-medium ${valueClass || "text-text"}`}>
        {value}
      </span>
    </div>
  );
}

type FinancialProfile = {
  dateOfBirth: string | null;
  age: number | null;
  annualIncome: number | null;
  filingStatus: string | null;
  stateOfResidence: string | null;
  employmentType: string | null;
  riskTolerance: string | null;
  retirementAge: number | null;
  employerMatchPercent: number | null;
};

type EditSection = "personal" | "income" | null;

const FILING_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married Filing Jointly" },
  { value: "married_separate", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
  { value: "qualifying_widow", label: "Qualifying Widow(er)" },
];

const RISK_TOLERANCE_OPTIONS: { value: string; label: string }[] = [
  { value: "conservative", label: "Conservative" },
  { value: "moderate_conservative", label: "Moderate-conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "moderate_aggressive", label: "Moderate-aggressive" },
  { value: "aggressive", label: "Aggressive" },
];

function formatFilingStatus(status: string | null): string {
  if (!status) return "Not set";
  const match = FILING_STATUS_OPTIONS.find((o) => o.value === status);
  return match?.label || status;
}

function formatRiskTolerance(risk: string | null): string {
  if (!risk) return "Not set";
  const match = RISK_TOLERANCE_OPTIONS.find((o) => o.value === risk);
  return match?.label || risk;
}

function riskToleranceColor(risk: string | null): string {
  if (!risk) return "text-text-muted";
  if (risk.includes("aggressive")) return "text-green-400";
  if (risk === "moderate") return "text-yellow-400";
  return "text-blue-400";
}

export function Settings() {
  const { user, tenant, logout } = useAuth();
  const [, navigate] = useLocation();

  const [profile, setProfile] = useState<FinancialProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [formData, setFormData] = useState({
    dateOfBirth: "",
    annualIncome: "",
    filingStatus: "",
    stateOfResidence: "",
    riskTolerance: "",
    employerMatchPercent: "",
    retirementAge: "",
  });

  const initial = (tenant?.name || user?.email || "U").charAt(0).toUpperCase();
  const displayName = tenant?.name || "User";
  const email = user?.email || "";

  const fetchProfile = useCallback(async () => {
    try {
      const res = await api.getFinancialProfile();
      setProfile(res.financialProfile);
    } catch {
      // Profile not found or not yet created
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const openEdit = (section: EditSection) => {
    setFormData({
      dateOfBirth: profile?.dateOfBirth ? profile.dateOfBirth.split("T")[0] : "",
      annualIncome: profile?.annualIncome?.toString() ?? "",
      filingStatus: profile?.filingStatus ?? "",
      stateOfResidence: profile?.stateOfResidence ?? "",
      riskTolerance: profile?.riskTolerance ?? "",
      employerMatchPercent: profile?.employerMatchPercent?.toString() ?? "",
      retirementAge: profile?.retirementAge?.toString() ?? "",
    });
    setEditSection(section);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};

      if (editSection === "personal") {
        updates.dateOfBirth = formData.dateOfBirth || null;
        updates.filingStatus = formData.filingStatus || null;
        updates.stateOfResidence =
          formData.stateOfResidence.toUpperCase() || null;
        updates.riskTolerance = formData.riskTolerance || null;
        updates.retirementAge = formData.retirementAge
          ? Number(formData.retirementAge)
          : null;
      } else if (editSection === "income") {
        updates.annualIncome = formData.annualIncome
          ? Number(formData.annualIncome)
          : null;
        updates.employerMatchPercent = formData.employerMatchPercent
          ? Number(formData.employerMatchPercent)
          : null;
      }

      await api.updateFinancialProfile(updates);
      await fetchProfile();
      setEditSection(null);
    } catch (err) {
      console.error("Failed to save profile:", err);
    } finally {
      setSaving(false);
    }
  };

  // Display values
  const age =
    profile?.age != null ? String(profile.age) : "Not set";
  const grossIncome =
    profile?.annualIncome != null
      ? `$${profile.annualIncome.toLocaleString()}/yr`
      : "Not set";
  const filingStatus = formatFilingStatus(profile?.filingStatus ?? null);
  const state = profile?.stateOfResidence || "Not set";
  const riskTolerance = formatRiskTolerance(profile?.riskTolerance ?? null);
  const riskColor = riskToleranceColor(profile?.riskTolerance ?? null);
  const employerMatch =
    profile?.employerMatchPercent != null
      ? `${profile.employerMatchPercent}%`
      : null;
  const retirementAge =
    profile?.retirementAge != null ? String(profile.retirementAge) : null;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="max-w-lg mx-auto space-y-6 pb-8"
      >
        {/* Profile Header */}
        <motion.div variants={item} className="flex flex-col items-center pt-4 pb-2">
          <div className="w-[72px] h-[72px] rounded-full bg-bg-elevated border border-border flex items-center justify-center mb-3">
            <span className="text-2xl font-bold text-text">{initial}</span>
          </div>
          <h1 className="font-display text-2xl font-semibold text-text">
            {displayName}
          </h1>
          <p className="text-sm text-text-muted">{email}</p>
        </motion.div>

        {/* Navigation Card */}
        <motion.div
          variants={item}
          className="glass-card rounded-2xl p-0 overflow-hidden divide-y divide-border"
        >
          <SettingsRow
            icon="👤"
            label="Personal Info"
            onClick={() => openEdit("personal")}
          />
          <SettingsRow
            icon="💼"
            label="Income & Employment"
            onClick={() => openEdit("income")}
          />
          <SettingsRow
            icon="🏦"
            label="Linked Accounts"
            onClick={() => navigate("/accounts")}
          />
          <SettingsRow icon="🎯" label="Financial Goals" />
        </motion.div>

        {/* Edit Modal - Personal Info */}
        {editSection === "personal" && (
          <motion.div
            variants={item}
            initial="hidden"
            animate="show"
            className="glass-card rounded-2xl p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-text">
              Personal Info
            </h2>

            <label className="block">
              <span className="text-sm text-text-secondary">Date of Birth</span>
              <input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, dateOfBirth: e.target.value }))
                }
                className="mt-1 w-full rounded-lg bg-bg-elevated border border-border px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <label className="block">
              <span className="text-sm text-text-secondary">Filing Status</span>
              <select
                value={formData.filingStatus}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, filingStatus: e.target.value }))
                }
                className="mt-1 w-full rounded-lg bg-bg-elevated border border-border px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Select...</option>
                {FILING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-text-secondary">
                State of Residence (2-letter code)
              </span>
              <input
                type="text"
                maxLength={2}
                value={formData.stateOfResidence}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    stateOfResidence: e.target.value,
                  }))
                }
                placeholder="CA"
                className="mt-1 w-full rounded-lg bg-bg-elevated border border-border px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <label className="block">
              <span className="text-sm text-text-secondary">Risk Tolerance</span>
              <select
                value={formData.riskTolerance}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, riskTolerance: e.target.value }))
                }
                className="mt-1 w-full rounded-lg bg-bg-elevated border border-border px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Select...</option>
                {RISK_TOLERANCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-text-secondary">Retirement Age</span>
              <input
                type="number"
                min={30}
                max={100}
                value={formData.retirementAge}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, retirementAge: e.target.value }))
                }
                placeholder="65"
                className="mt-1 w-full rounded-lg bg-bg-elevated border border-border px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditSection(null)}
                className="flex-1 rounded-lg bg-bg-elevated border border-border px-4 py-2.5 text-sm font-medium text-text hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {/* Edit Modal - Income & Employment */}
        {editSection === "income" && (
          <motion.div
            variants={item}
            initial="hidden"
            animate="show"
            className="glass-card rounded-2xl p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-text">
              Income & Employment
            </h2>

            <label className="block">
              <span className="text-sm text-text-secondary">
                Annual Gross Income ($)
              </span>
              <input
                type="number"
                min={0}
                step={1000}
                value={formData.annualIncome}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, annualIncome: e.target.value }))
                }
                placeholder="72000"
                className="mt-1 w-full rounded-lg bg-bg-elevated border border-border px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <label className="block">
              <span className="text-sm text-text-secondary">
                Employer Match (%)
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={formData.employerMatchPercent}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    employerMatchPercent: e.target.value,
                  }))
                }
                placeholder="4"
                className="mt-1 w-full rounded-lg bg-bg-elevated border border-border px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </label>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditSection(null)}
                className="flex-1 rounded-lg bg-bg-elevated border border-border px-4 py-2.5 text-sm font-medium text-text hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {/* Your Profile Stats */}
        <motion.div variants={item}>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider px-1 mb-2">
            Your Profile
          </h2>
          <div className="glass-card rounded-2xl p-0 overflow-hidden divide-y divide-border">
            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-text-muted">
                Loading...
              </div>
            ) : (
              <>
                <StatRow label="Age" value={age} />
                <StatRow label="Gross income" value={grossIncome} />
                <StatRow label="Filing status" value={filingStatus} />
                <StatRow label="State" value={state} />
                <StatRow
                  label="Risk tolerance"
                  value={riskTolerance}
                  valueClass={riskColor}
                />
                {employerMatch && (
                  <StatRow label="Employer match" value={employerMatch} />
                )}
                {retirementAge && (
                  <StatRow label="Retirement age" value={retirementAge} />
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Settings Card */}
        <motion.div
          variants={item}
          className="glass-card rounded-2xl p-0 overflow-hidden divide-y divide-border"
        >
          <SettingsRow icon="🔔" label="Notifications" />
          <SettingsRow icon="🔒" label="Privacy & Security" />
          <SettingsRow icon="❓" label="Help & Support" />
          <SettingsRow
            icon="🚪"
            label="Sign Out"
            danger
            onClick={() => logout()}
          />
        </motion.div>

        {/* Footer */}
        <motion.p
          variants={item}
          className="text-xs text-text-muted text-center pt-2"
        >
          Lasagna v0.1.0 · Built in the open
        </motion.p>
      </motion.div>
    </div>
  );
}
