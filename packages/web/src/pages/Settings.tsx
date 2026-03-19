import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { formatMoney } from "../lib/utils";
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
  first?: boolean;
}

function SettingsRow({ icon, label, danger, onClick, first }: SettingsRowProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: 0,
        borderTop: first ? 0 : '1px solid var(--lf-rule)',
        background: hovered ? 'var(--lf-cream)' : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.1s',
        fontFamily: "'Geist', system-ui, sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{
          fontSize: 14,
          color: danger ? 'var(--lf-sauce)' : 'var(--lf-ink-soft)',
          fontWeight: danger ? 500 : 400,
        }}>
          {label}
        </span>
      </div>
      {onClick && <span style={{ color: 'var(--lf-muted)', fontSize: 16 }}>›</span>}
    </button>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  valueColor?: string;
  first?: boolean;
}

function StatRow({ label, value, valueColor, first }: StatRowProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 18px',
      borderTop: first ? 0 : '1px solid var(--lf-rule)',
      fontFamily: "'Geist', system-ui, sans-serif",
    }}>
      <span style={{ fontSize: 13, color: 'var(--lf-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: valueColor || 'var(--lf-ink)', fontWeight: 500 }}>{value}</span>
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
  dependentCount: number | null;
  hasHDHP: boolean | null;
  isPSLFEligible: boolean | null;
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
  if (!risk) return 'var(--lf-muted)';
  if (risk.includes('aggressive')) return 'var(--lf-basil)';
  if (risk === 'moderate') return 'var(--lf-cheese)';
  return 'var(--lf-sauce)';
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--lf-cream)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--lf-ink)',
  fontFamily: "'Geist', system-ui, sans-serif",
  outline: 'none',
  boxSizing: 'border-box',
};

const labelTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--lf-muted)',
  marginBottom: 6,
  fontFamily: "'Geist', system-ui, sans-serif",
};

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
    employmentType: "w2",
    dependentCount: "",
    hasHDHP: false,
    isPSLFEligible: false,
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
      employmentType: profile?.employmentType ?? "w2",
      dependentCount: profile?.dependentCount?.toString() ?? "",
      hasHDHP: profile?.hasHDHP ?? false,
      isPSLFEligible: profile?.isPSLFEligible ?? false,
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
        updates.dependentCount = formData.dependentCount !== ""
          ? Number(formData.dependentCount)
          : null;
        updates.hasHDHP = formData.hasHDHP;
        updates.isPSLFEligible = formData.isPSLFEligible;
      } else if (editSection === "income") {
        updates.annualIncome = formData.annualIncome
          ? Number(formData.annualIncome)
          : null;
        updates.employerMatchPercent = formData.employerMatchPercent
          ? Number(formData.employerMatchPercent)
          : null;
        updates.employmentType = formData.employmentType || null;
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
      ? `${formatMoney(profile.annualIncome, true)}/yr`
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

  const cardStyle: React.CSSProperties = {
    background: 'var(--lf-paper)',
    border: '1px solid var(--lf-rule)',
    borderRadius: 14,
    overflow: 'hidden',
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--lf-muted)',
    marginBottom: 8,
    paddingLeft: 4,
  };

  return (
    <div
      style={{ flex: 1, overflowY: 'auto', background: 'var(--lf-paper)', padding: '24px 20px 48px' }}
      className="scrollbar-thin"
    >
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        style={{ maxWidth: 520, margin: '0 auto' }}
      >
        {/* Profile Header */}
        <motion.div
          variants={item}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16, paddingBottom: 8, marginBottom: 24 }}
        >
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: 'var(--lf-sauce)',
            color: 'var(--lf-paper)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 28,
            marginBottom: 12,
          }}>
            {initial}
          </div>
          <h1 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--lf-ink)',
            margin: 0,
          }}>
            {displayName}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--lf-muted)', marginTop: 4, fontFamily: "'Geist', system-ui, sans-serif" }}>
            {email}
          </p>
        </motion.div>

        {/* Navigation Card */}
        <motion.div variants={item} style={{ ...cardStyle, marginBottom: 24 }}>
          <SettingsRow
            icon="👤"
            label="Personal Info"
            first
            onClick={import.meta.env.VITE_DEMO_MODE !== "true" ? () => openEdit("personal") : undefined}
          />
          <SettingsRow
            icon="💼"
            label="Income & Employment"
            onClick={import.meta.env.VITE_DEMO_MODE !== "true" ? () => openEdit("income") : undefined}
          />
          <SettingsRow
            icon="🏦"
            label="Linked Accounts"
            onClick={() => navigate("/accounts")}
          />
          <SettingsRow icon="🎯" label="Financial Goals" />
        </motion.div>

        {/* Edit Panel - Personal Info */}
        {editSection === "personal" && import.meta.env.VITE_DEMO_MODE !== "true" && (
          <motion.div
            variants={item}
            initial="hidden"
            animate="show"
            style={{ ...cardStyle, padding: 20, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <h2 style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--lf-ink)',
              margin: 0,
            }}>
              Personal Info
            </h2>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Date of Birth</span>
              <input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, dateOfBirth: e.target.value }))
                }
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Filing Status</span>
              <select
                value={formData.filingStatus}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, filingStatus: e.target.value }))
                }
                style={inputStyle}
              >
                <option value="">Select...</option>
                {FILING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>State of Residence (2-letter code)</span>
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
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Risk Tolerance</span>
              <select
                value={formData.riskTolerance}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, riskTolerance: e.target.value }))
                }
                style={inputStyle}
              >
                <option value="">Select...</option>
                {RISK_TOLERANCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Retirement Age</span>
              <input
                type="number"
                min={30}
                max={100}
                value={formData.retirementAge}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, retirementAge: e.target.value }))
                }
                placeholder="65"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Number of dependents</span>
              <input
                type="number"
                min={0}
                max={10}
                value={formData.dependentCount}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, dependentCount: e.target.value }))
                }
                placeholder="0"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={formData.hasHDHP}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, hasHDHP: e.target.checked }))
                }
                style={{ width: 16, height: 16, accentColor: 'var(--lf-sauce)', cursor: 'pointer' }}
              />
              <span style={{ ...labelTextStyle, display: 'inline', marginBottom: 0 }}>
                Enrolled in a high-deductible health plan (HDHP)
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={formData.isPSLFEligible}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, isPSLFEligible: e.target.checked }))
                }
                style={{ width: 16, height: 16, accentColor: 'var(--lf-sauce)', cursor: 'pointer' }}
              />
              <span style={{ ...labelTextStyle, display: 'inline', marginBottom: 0 }}>
                Work in public service (PSLF eligible)
              </span>
            </label>

            <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: 'var(--lf-ink)',
                  color: 'var(--lf-paper)',
                  border: 0,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: "'Geist', system-ui, sans-serif",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditSection(null)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: 'transparent',
                  color: 'var(--lf-ink-soft)',
                  border: '1px solid var(--lf-rule)',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: "'Geist', system-ui, sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {/* Edit Panel - Income & Employment */}
        {editSection === "income" && import.meta.env.VITE_DEMO_MODE !== "true" && (
          <motion.div
            variants={item}
            initial="hidden"
            animate="show"
            style={{ ...cardStyle, padding: 20, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <h2 style={{
              fontFamily: "'Geist', system-ui, sans-serif",
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--lf-ink)',
              margin: 0,
            }}>
              Income &amp; Employment
            </h2>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Employment type</span>
              <select
                value={formData.employmentType}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, employmentType: e.target.value }))
                }
                style={inputStyle}
              >
                <option value="w2">W2 employee</option>
                <option value="self_employed">Self-employed</option>
                <option value="1099">1099 / contractor</option>
                <option value="business_owner">Business owner</option>
              </select>
            </label>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Annual Gross Income ($)</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={formData.annualIncome}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, annualIncome: e.target.value }))
                }
                placeholder="72000"
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'block' }}>
              <span style={labelTextStyle}>Employer Match (%)</span>
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
                style={inputStyle}
              />
            </label>

            <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: 'var(--lf-ink)',
                  color: 'var(--lf-paper)',
                  border: 0,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: "'Geist', system-ui, sans-serif",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditSection(null)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  background: 'transparent',
                  color: 'var(--lf-ink-soft)',
                  border: '1px solid var(--lf-rule)',
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: "'Geist', system-ui, sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {/* Your Profile Stats */}
        <motion.div variants={item} style={{ marginBottom: 24 }}>
          <div style={sectionLabelStyle}>YOUR PROFILE</div>
          <div style={cardStyle}>
            {loading ? (
              <div style={{
                padding: '32px 20px',
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--lf-muted)',
                fontFamily: "'Geist', system-ui, sans-serif",
              }}>
                Loading...
              </div>
            ) : (
              <>
                <StatRow label="Age" value={age} first />
                <StatRow label="Gross income" value={grossIncome} />
                <StatRow label="Filing status" value={filingStatus} />
                <StatRow label="State" value={state} />
                <StatRow
                  label="Risk tolerance"
                  value={riskTolerance}
                  valueColor={riskColor}
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
        <motion.div variants={item} style={{ ...cardStyle, marginBottom: 24 }}>
          <SettingsRow icon="🔔" label="Notifications" first />
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
          style={{
            fontSize: 13,
            color: 'var(--lf-muted)',
            textAlign: 'center',
            paddingTop: 8,
            fontFamily: "'JetBrains Mono', monospace",
            margin: 0,
          }}
        >
          Lasagna v0.1.0 · Built in the open
        </motion.p>
      </motion.div>
    </div>
  );
}
