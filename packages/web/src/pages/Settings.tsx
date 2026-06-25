import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useBilling, startUpgrade, openPortal } from "../lib/billing";
import { formatMoney } from "../lib/utils";
import { useState, useEffect, useCallback } from "react";
import {
  User,
  Briefcase,
  Building2,
  Target,
  ChevronRight,
  ChevronDown,
  LogOut,
  Sparkles,
  Check,
} from "lucide-react";
import {
  Page,
  Section,
  Button,
  Eyebrow,
} from "../components/ds";

// ─── Types ───────────────────────────────────────────────────────────────────

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

function formatEmployment(type: string): string {
  switch (type) {
    case "w2": return "W2 employee";
    case "self_employed": return "Self-employed";
    case "1099": return "1099 / contractor";
    case "business_owner": return "Business owner";
    case "Not set": return "Not set";
    default: return type;
  }
}

// ─── Main component ──────────────────────────────────────────────────────────

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

  const displayName = tenant?.name || user?.name || "Profile";
  const firstName = displayName.split(" ")[0] || "Profile";
  const email = user?.email || "";

  const fetchProfile = useCallback(async () => {
    try {
      const res = await api.getFinancialProfile();
      setProfile(res.financialProfile);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const openEdit = (section: EditSection) => {
    if (editSection === section) {
      setEditSection(null);
      return;
    }
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
  const age = profile?.age != null ? String(profile.age) : "Not set";
  const grossIncome =
    profile?.annualIncome != null
      ? `${formatMoney(profile.annualIncome, true)}/yr`
      : "Not set";
  const filingStatus = formatFilingStatus(profile?.filingStatus ?? null);
  const state = profile?.stateOfResidence || "Not set";
  const riskTolerance = formatRiskTolerance(profile?.riskTolerance ?? null);
  const employerMatch =
    profile?.employerMatchPercent != null
      ? `${profile.employerMatchPercent}%`
      : "Not set";
  const retirementAge =
    profile?.retirementAge != null ? String(profile.retirementAge) : "Not set";
  const dependents = profile?.dependentCount != null ? String(profile.dependentCount) : "Not set";
  const employmentType = profile?.employmentType || "Not set";

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const canEdit = !isDemoMode;

  const personalRows: ArticleRowSpec[] = [
    { label: "Date of birth", value: profile?.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : "Not set", muted: !profile?.dateOfBirth },
    { label: "Age", value: age, muted: age === "Not set" },
    { label: "Filing status", value: filingStatus, muted: !profile?.filingStatus },
    { label: "State of residence", value: state, muted: state === "Not set" },
    { label: "Risk tolerance", value: riskTolerance, muted: !profile?.riskTolerance },
    { label: "Dependents", value: dependents, muted: dependents === "Not set" },
  ];

  const incomeRows: ArticleRowSpec[] = [
    { label: "Gross income", value: grossIncome, muted: grossIncome === "Not set" },
    { label: "Employment type", value: formatEmployment(employmentType), muted: employmentType === "Not set" },
    { label: "Employer match", value: employerMatch, muted: employerMatch === "Not set" },
    { label: "Retirement age", value: retirementAge, muted: retirementAge === "Not set" },
  ];

  // Iter 7 A: ds-page-bar replaces the editorial PageHeader + Lede so
  // /profile lives inside the same chrome as the rest of the product.
  const captionBits: string[] = [];
  if (email) captionBits.push(email);
  if (state !== "Not set") captionBits.push(state);
  if (age !== "Not set") captionBits.push(`age ${age}`);

  return (
    <Page width="narrow">
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Profile · {firstName}</h1>
          {captionBits.length > 0 && (
            <span className="ds-page-bar__caption">{captionBits.join(' · ')}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => logout()}
          icon={<LogOut size={13} />}
          className="ds-settings-signout"
        >
          Sign out
        </Button>
      </header>

      {/* ── Personal info ─────────────────────────────────────── */}
      <Section eyebrow="Personal">
        <EditorialArticle
          icon={<User size={16} />}
          title="Personal info"
          summary={`${age === "Not set" ? "Age not set" : `Age ${age}`} · ${dependents === "Not set" ? "0 dependents" : `${dependents} dependent${dependents === "1" ? "" : "s"}`}${state !== "Not set" ? ` · ${state}` : ""}`}
          rows={personalRows}
          loading={loading}
          editable={canEdit}
          expanded={editSection === "personal"}
          onEdit={() => openEdit("personal")}
        >
          {editSection === "personal" && canEdit && (
            <PersonalEditPanel
              formData={formData}
              setFormData={setFormData}
              saving={saving}
              onCancel={() => setEditSection(null)}
              onSave={handleSave}
            />
          )}
        </EditorialArticle>
      </Section>

      {/* ── Income & employment ───────────────────────────────── */}
      <Section eyebrow="Income">
        <EditorialArticle
          icon={<Briefcase size={16} />}
          title="Income & employment"
          summary={`${grossIncome}${employerMatch !== "Not set" ? ` · ${employerMatch} match` : " · no match"}`}
          rows={incomeRows}
          loading={loading}
          editable={canEdit}
          expanded={editSection === "income"}
          onEdit={() => openEdit("income")}
        >
          {editSection === "income" && canEdit && (
            <IncomeEditPanel
              formData={formData}
              setFormData={setFormData}
              saving={saving}
              onCancel={() => setEditSection(null)}
              onSave={handleSave}
            />
          )}
        </EditorialArticle>
      </Section>

      {/* ── Plan & billing ────────────────────────────────────── */}
      <Section eyebrow="Plan">
        <PlanCard />
      </Section>

      {/* ── Linked accounts ───────────────────────────────────── */}
      <Section title="Linked accounts">
        <NavLine
          icon={<Building2 size={16} />}
          label="Manage accounts"
          sub="Banks, brokerages, and manual balances"
          onClick={() => navigate("/accounts")}
        />
      </Section>


      {/* ── Financial goals ───────────────────────────────────── */}
      <Section title="Financial goals">
        <NavLine
          icon={<Target size={16} />}
          label="Manage goals"
          sub="Targets, milestones, progress"
          onClick={() => navigate("/goals")}
        />
      </Section>

      {/* Sign-out now lives in the page-bar action slot (iter 7 A) so the
          page no longer needs a redundant "Account / Session" section. */}

      <style>{`
        .ds-article {
          border-top: 1px solid var(--lf-ink);
          padding: 0;
        }
        .ds-article__head {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 18px 0 14px;
          border-bottom: 1px solid var(--lf-rule-soft);
          width: 100%;
          background: none;
          border-left: 0; border-right: 0; border-top: 0;
          cursor: pointer;
          text-align: left;
          font-family: 'Geist', system-ui, sans-serif;
          color: inherit;
        }
        .ds-article__head:disabled { cursor: default; }
        .ds-article__head-icon {
          width: 28px; height: 28px;
          display: grid; place-items: center;
          color: var(--lf-ink-soft);
          flex-shrink: 0;
        }
        .ds-article__head-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ds-article__head-title {
          display: block;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 20px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.2;
        }
        .ds-article__head-sub {
          display: block;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          color: var(--lf-muted);
        }
        .ds-article__head-chev {
          color: var(--lf-muted);
          flex-shrink: 0;
          display: flex;
          transition: color 0.15s;
        }
        .ds-article__head:not(:disabled):hover .ds-article__head-chev { color: var(--lf-sauce); }
        .ds-article__row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
          padding: 12px 0;
          border-bottom: 1px solid var(--lf-rule-soft);
        }
        .ds-article__row:last-child { border-bottom: 0; }
        .ds-article__row-label {
          /* Quiet sans label — the figure on the right is the signal,
             this is just naming the row. */
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          letter-spacing: 0;
          text-transform: none;
          font-weight: 400;
          color: var(--lf-muted);
        }
        .ds-article__row-value {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 15px;
          color: var(--lf-ink);
          font-weight: 600;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .ds-article__row-value--muted { color: var(--lf-muted); font-weight: 400; }
        .ds-article__edit {
          padding: 20px 0 8px;
          border-bottom: 1px solid var(--lf-rule-soft);
          display: flex; flex-direction: column; gap: 16px;
        }
        .ds-article__skeleton {
          height: 80px;
          background: var(--lf-cream);
          border-radius: 6px;
        }
        .ds-navline {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          padding: 18px 0;
          border: 0;
          border-top: 1px solid var(--lf-ink);
          background: none;
          font-family: 'Geist', system-ui, sans-serif;
          color: inherit;
          cursor: pointer;
          text-align: left;
        }
        .ds-navline-icon {
          width: 28px; height: 28px;
          display: grid; place-items: center;
          color: var(--lf-ink-soft);
          flex-shrink: 0;
        }
        .ds-navline-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ds-navline-title {
          display: block;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 20px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.2;
          transition: color 0.15s;
        }
        .ds-navline-sub {
          display: block;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          color: var(--lf-muted);
        }
        .ds-navline-chev {
          color: var(--lf-muted);
          display: flex;
          transition: color 0.15s, transform 0.15s;
        }
        .ds-navline:hover .ds-navline-title { color: var(--lf-sauce); }
        .ds-navline:hover .ds-navline-chev { color: var(--lf-sauce); transform: translateX(2px); }
        .ds-settings-input {
          width: 100%;
          padding: 12px 14px;
          background: var(--lf-paper);
          border: 1px solid var(--lf-rule);
          border-radius: 8px;
          /* 16px prevents iOS Safari auto-zoom on focus */
          font-size: 16px;
          color: var(--lf-ink);
          font-family: 'Geist', system-ui, sans-serif;
          outline: none;
          box-sizing: border-box;
        }
        .ds-settings-input:focus { border-color: var(--lf-ink); }
        .ds-settings-signout {
          color: var(--lf-sauce);
          min-height: 44px;
          padding-left: 16px; padding-right: 16px;
          border-color: rgba(201,84,58,0.4);
        }
        .ds-settings-signout:hover { color: var(--lf-sauce-deep); border-color: rgba(201,84,58,0.6); }
        .ds-settings-lede { margin-bottom: 40px; }
        @media (max-width: 640px) {
          .ds-settings-lede { margin-bottom: 20px; }
        }
      `}</style>
    </Page>
  );
}

// ─── Editorial article ───────────────────────────────────────────────────────

interface ArticleRowSpec {
  label: string;
  value: string;
  muted?: boolean;
}

interface EditorialArticleProps {
  icon: React.ReactNode;
  title?: string;
  summary: string;
  rows: ArticleRowSpec[];
  loading: boolean;
  editable: boolean;
  expanded: boolean;
  onEdit: () => void;
  children?: React.ReactNode;
}

function EditorialArticle({ icon, title, summary, rows, loading, editable, expanded, onEdit, children }: EditorialArticleProps) {
  return (
    <article className="ds-article">
      <button
        type="button"
        className="ds-article__head"
        onClick={editable ? onEdit : undefined}
        disabled={!editable}
        aria-expanded={expanded}
      >
        <span className="ds-article__head-icon">{icon}</span>
        <span className="ds-article__head-body">
          {title && <span className="ds-article__head-title">{title}</span>}
          <span className="ds-article__head-sub">{summary}</span>
        </span>
        {editable && (
          <span className="ds-article__head-chev">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        )}
      </button>

      {loading ? (
        <div style={{ padding: '20px 0' }}>
          <div className="ds-article__skeleton animate-pulse" />
        </div>
      ) : expanded && editable ? (
        children
      ) : (
        <div>
          {rows.map((r) => (
            <div key={r.label} className="ds-article__row">
              <span className="ds-article__row-label">{r.label}</span>
              <span className={`ds-article__row-value${r.muted ? ' ds-article__row-value--muted' : ''}`}>
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// ─── NavLine — single editorial row that navigates somewhere ─────────────────

function NavLine({
  icon, label, sub, onClick,
}: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ds-navline">
      <span className="ds-navline-icon">{icon}</span>
      <span className="ds-navline-body">
        <span className="ds-navline-title">{label}</span>
        {sub && <span className="ds-navline-sub">{sub}</span>}
      </span>
      <span className="ds-navline-chev"><ChevronRight size={16} /></span>
    </button>
  );
}

// ─── Plan & billing ──────────────────────────────────────────────────────────

const PRO_FEATURES = [
  "50 connected accounts",
  'Manual "Sync now"',
  "Premium AI models",
];

const FREE_FEATURES = [
  "3 connected accounts",
  "Daily auto-sync",
  "Basic AI model",
];

function PlanCard() {
  const { status, loading, refresh } = useBilling();
  const [upgrading, setUpgrading] = useState(false);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState("");
  const [welcome, setWelcome] = useState(false);

  // After Stripe Checkout redirects back with ?upgraded=1, the webhook that
  // flips the plan may land a beat later — so refresh now and again shortly.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgraded") !== "1") return;
    setWelcome(true);
    refresh();
    const t = setTimeout(() => refresh(), 2000);
    return () => clearTimeout(t);
  }, [refresh]);

  const handleUpgrade = async () => {
    setUpgrading(true);
    setError("");
    try {
      await startUpgrade();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start upgrade");
      setUpgrading(false);
    }
  };

  const handleManage = async () => {
    setManaging(true);
    setError("");
    try {
      await openPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open billing portal");
      setManaging(false);
    }
  };

  const isPro = status?.plan === "pro";
  const periodDate = status?.currentPeriodEnd
    ? new Date(status.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;
  const cancelScheduled = !!status?.cancelAtPeriodEnd;
  // When a cancellation is scheduled, the subscription is still active (Pro)
  // until the period end — so show "Cancels on" instead of "Renews".
  const periodLabel = periodDate
    ? `${cancelScheduled ? "Cancels" : "Renews"} ${periodDate}`
    : null;

  return (
    <article className="ds-article">
      <div className="ds-article__head" style={{ cursor: "default" }}>
        <span className="ds-article__head-icon"><Sparkles size={16} /></span>
        <span className="ds-article__head-body">
          <span className="ds-article__head-title">{isPro ? "Pro" : "Free plan"}</span>
          <span className="ds-article__head-sub">
            {isPro
              ? cancelScheduled
                ? (periodLabel ?? "Cancels at period end")
                : `${(status?.subscriptionStatus ?? "active").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}${periodLabel ? ` · ${periodLabel}` : ""}`
              : `${FREE_FEATURES.join(" · ")}`}
          </span>
        </span>
      </div>

      {welcome && (
        <p className="ds-plan-welcome">Welcome to Pro! Your account is being upgraded.</p>
      )}

      {loading ? (
        <div style={{ padding: "20px 0" }}>
          <div className="ds-article__skeleton animate-pulse" />
        </div>
      ) : isPro ? (
        <div className="ds-plan-body">
          <ul className="ds-plan-features">
            {PRO_FEATURES.map((f) => (
              <li key={f}><Check size={13} /> {f}</li>
            ))}
          </ul>
          {cancelScheduled && periodDate && (
            <p className="ds-plan-cancel-note">
              Your subscription is set to cancel on {periodDate}. You'll keep Pro until then —
              reactivate any time from Manage subscription.
            </p>
          )}
          <Button variant="ghost" onClick={handleManage} disabled={managing}>
            {managing ? "Redirecting…" : "Manage subscription"}
          </Button>
        </div>
      ) : (
        <div className="ds-plan-body">
          <div className="ds-plan-compare">
            <div className="ds-plan-col">
              <p className="ds-plan-col__head">Free</p>
              <ul className="ds-plan-features">
                {FREE_FEATURES.map((f) => (
                  <li key={f}><Check size={13} /> {f}</li>
                ))}
              </ul>
            </div>
            <div className="ds-plan-col ds-plan-col--pro">
              <p className="ds-plan-col__head">Pro · $11.99/mo</p>
              <ul className="ds-plan-features">
                {PRO_FEATURES.map((f) => (
                  <li key={f}><Check size={13} /> {f}</li>
                ))}
              </ul>
            </div>
          </div>
          <Button variant="ink" onClick={handleUpgrade} disabled={upgrading}>
            {upgrading ? "Redirecting…" : "Upgrade to Pro"}
          </Button>
        </div>
      )}

      {error && <p className="ds-plan-error">{error}</p>}

      <style>{`
        .ds-plan-welcome {
          margin: 14px 0 0;
          padding: 10px 14px;
          border-radius: 8px;
          background: rgba(90,107,63,0.08);
          border: 1px solid rgba(90,107,63,0.25);
          color: var(--lf-ink);
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
        }
        .ds-plan-body {
          padding: 18px 0 8px;
          display: flex; flex-direction: column; gap: 18px;
          align-items: flex-start;
        }
        .ds-plan-compare {
          display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
          width: 100%;
        }
        .ds-plan-col {
          padding: 14px 16px;
          border: 1px solid var(--lf-rule);
          border-radius: 10px;
        }
        .ds-plan-col--pro {
          background: var(--lf-cream);
          border-color: var(--lf-cream-deep);
        }
        .ds-plan-col__head {
          margin: 0 0 10px;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px; font-weight: 600;
          color: var(--lf-ink);
        }
        .ds-plan-features {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-direction: column; gap: 8px;
        }
        .ds-plan-features li {
          display: flex; align-items: center; gap: 8px;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px; color: var(--lf-ink-soft);
        }
        .ds-plan-features li svg { color: var(--lf-sauce); flex-shrink: 0; }
        .ds-plan-error {
          margin: 12px 0 0;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px; color: var(--lf-sauce);
        }
        .ds-plan-cancel-note {
          margin: 4px 0 12px;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px; line-height: 1.5; color: var(--lf-text-muted, #6b7280);
        }
        @media (max-width: 520px) {
          .ds-plan-compare { grid-template-columns: 1fr; }
        }
      `}</style>
    </article>
  );
}

// ─── Edit panels ─────────────────────────────────────────────────────────────

interface EditPanelProps {
  formData: {
    dateOfBirth: string;
    annualIncome: string;
    filingStatus: string;
    stateOfResidence: string;
    riskTolerance: string;
    employerMatchPercent: string;
    retirementAge: string;
    employmentType: string;
    dependentCount: string;
    hasHDHP: boolean;
    isPSLFEligible: boolean;
  };
  setFormData: React.Dispatch<React.SetStateAction<EditPanelProps['formData']>>;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Eyebrow style={{ display: 'block', marginBottom: 6 }}>{children}</Eyebrow>;
}

function PersonalEditPanel({ formData, setFormData, saving, onCancel, onSave }: EditPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="ds-article__edit"
    >
      <div>
        <FieldLabel>Date of birth</FieldLabel>
        <input
          type="date"
          value={formData.dateOfBirth}
          onChange={(e) => setFormData((f) => ({ ...f, dateOfBirth: e.target.value }))}
          className="ds-settings-input"
        />
      </div>

      <div>
        <FieldLabel>Filing status</FieldLabel>
        <select
          value={formData.filingStatus}
          onChange={(e) => setFormData((f) => ({ ...f, filingStatus: e.target.value }))}
          className="ds-settings-input"
        >
          <option value="">Select…</option>
          {FILING_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel>State of residence (2-letter)</FieldLabel>
        <input
          type="text"
          maxLength={2}
          value={formData.stateOfResidence}
          onChange={(e) => setFormData((f) => ({ ...f, stateOfResidence: e.target.value }))}
          placeholder="CA"
          className="ds-settings-input"
        />
      </div>

      <div>
        <FieldLabel>Risk tolerance</FieldLabel>
        <select
          value={formData.riskTolerance}
          onChange={(e) => setFormData((f) => ({ ...f, riskTolerance: e.target.value }))}
          className="ds-settings-input"
        >
          <option value="">Select…</option>
          {RISK_TOLERANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel>Retirement age</FieldLabel>
        <input
          type="number"
          min={30}
          max={100}
          value={formData.retirementAge}
          onChange={(e) => setFormData((f) => ({ ...f, retirementAge: e.target.value }))}
          placeholder="65"
          className="ds-settings-input"
        />
      </div>

      <div>
        <FieldLabel>Number of dependents</FieldLabel>
        <input
          type="number"
          min={0}
          max={10}
          value={formData.dependentCount}
          onChange={(e) => setFormData((f) => ({ ...f, dependentCount: e.target.value }))}
          placeholder="0"
          className="ds-settings-input"
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={formData.hasHDHP}
          onChange={(e) => setFormData((f) => ({ ...f, hasHDHP: e.target.checked }))}
          style={{ width: 16, height: 16, accentColor: 'var(--lf-sauce)', cursor: 'pointer' }}
        />
        <span style={{ fontSize: 13, color: 'var(--lf-ink-soft)', fontFamily: "'Geist', system-ui, sans-serif" }}>
          Enrolled in a high-deductible health plan (HDHP)
        </span>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
        <input
          type="checkbox"
          checked={formData.isPSLFEligible}
          onChange={(e) => setFormData((f) => ({ ...f, isPSLFEligible: e.target.checked }))}
          style={{ width: 16, height: 16, accentColor: 'var(--lf-sauce)', cursor: 'pointer' }}
        />
        <span style={{ fontSize: 13, color: 'var(--lf-ink-soft)', fontFamily: "'Geist', system-ui, sans-serif" }}>
          Work in public service (PSLF eligible)
        </span>
      </label>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <Button variant="ink" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </motion.div>
  );
}

function IncomeEditPanel({ formData, setFormData, saving, onCancel, onSave }: EditPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="ds-article__edit"
    >
      <div>
        <FieldLabel>Employment type</FieldLabel>
        <select
          value={formData.employmentType}
          onChange={(e) => setFormData((f) => ({ ...f, employmentType: e.target.value }))}
          className="ds-settings-input"
        >
          <option value="w2">W2 employee</option>
          <option value="self_employed">Self-employed</option>
          <option value="1099">1099 / contractor</option>
          <option value="business_owner">Business owner</option>
        </select>
      </div>

      <div>
        <FieldLabel>Annual gross income ($)</FieldLabel>
        <input
          type="number"
          min={0}
          step={1000}
          value={formData.annualIncome}
          onChange={(e) => setFormData((f) => ({ ...f, annualIncome: e.target.value }))}
          placeholder="72000"
          className="ds-settings-input"
        />
      </div>

      <div>
        <FieldLabel>Employer match (%)</FieldLabel>
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={formData.employerMatchPercent}
          onChange={(e) => setFormData((f) => ({ ...f, employerMatchPercent: e.target.value }))}
          placeholder="4"
          className="ds-settings-input"
        />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <Button variant="ink" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </motion.div>
  );
}

