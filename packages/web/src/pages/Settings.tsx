import { AnimatePresence, motion } from "framer-motion";
import { useLocation } from "wouter";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { useBilling, startUpgrade, openPortal } from "../lib/billing";
import { formatMoney, cn } from "../lib/utils";
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
  Button,
  Surface,
  Eyebrow,
  Field,
  Input,
  Select,
  Badge,
  Alert,
  Skeleton,
} from "../components/uikit";

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
    { label: "Gross income", value: grossIncome, muted: grossIncome === "Not set", money: true },
    { label: "Employment type", value: formatEmployment(employmentType), muted: employmentType === "Not set" },
    { label: "Employer match", value: employerMatch, muted: employerMatch === "Not set", money: true },
    { label: "Retirement age", value: retirementAge, muted: retirementAge === "Not set", money: true },
  ];

  const captionBits: string[] = [];
  if (email) captionBits.push(email);
  if (state !== "Not set") captionBits.push(state);
  if (age !== "Not set") captionBits.push(`age ${age}`);

  return (
    <div className="mx-auto max-w-[820px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-start justify-between gap-4 animate-fade-in border-b border-line pb-6">
        <div className="min-w-0">
          <Eyebrow>Profile</Eyebrow>
          <h1 className="mt-1.5 font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            {firstName}
          </h1>
          {captionBits.length > 0 && (
            <p className="mt-2 text-[13.5px] font-semibold text-content-muted">
              {captionBits.join(' · ')}
            </p>
          )}
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => logout()}
          leadingIcon={<LogOut className="h-4 w-4" />}
        >
          Sign out
        </Button>
      </header>

      <div className="mt-6 space-y-5">
        {/* ── Personal info ── */}
        <SettingsCard
          eyebrow="Personal"
          icon={<User className="h-5 w-5" />}
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
        </SettingsCard>

        {/* ── Income & employment ── */}
        <SettingsCard
          eyebrow="Income"
          icon={<Briefcase className="h-5 w-5" />}
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
        </SettingsCard>

        {/* ── Plan & billing ── */}
        <PlanCard />

        {/* ── Linked accounts ── */}
        <NavCard
          eyebrow="Accounts"
          icon={<Building2 className="h-5 w-5" />}
          label="Manage accounts"
          sub="Banks, brokerages, and manual balances"
          onClick={() => navigate("/accounts")}
        />

        {/* ── Financial goals ── */}
        <NavCard
          eyebrow="Goals"
          icon={<Target className="h-5 w-5" />}
          label="Manage goals"
          sub="Targets, milestones, progress"
          onClick={() => navigate("/goals")}
        />
      </div>
    </div>
  );
}

// ─── Settings card ───────────────────────────────────────────────────────────

interface ArticleRowSpec {
  label: string;
  value: string;
  muted?: boolean;
  money?: boolean;
}

interface SettingsCardProps {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  summary: string;
  rows: ArticleRowSpec[];
  loading: boolean;
  editable: boolean;
  expanded: boolean;
  onEdit: () => void;
  children?: React.ReactNode;
}

function SettingsCard({ eyebrow, icon, title, summary, rows, loading, editable, expanded, onEdit, children }: SettingsCardProps) {
  return (
    <Surface pad="none" className="overflow-hidden">
      <button
        type="button"
        onClick={editable ? onEdit : undefined}
        disabled={!editable}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center gap-3.5 px-5 py-4 text-left sm:px-6",
          editable && "min-h-touch transition-colors hover:bg-canvas-sunken",
          !editable && "cursor-default",
        )}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-brand-soft text-brand">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-bold uppercase tracking-[0.11em] text-content-muted">{eyebrow}</span>
          <span className="mt-0.5 block font-editorial text-[19px] font-bold leading-[1.15] tracking-[-0.018em] text-content">{title}</span>
          <span className="mt-0.5 block truncate text-[12.5px] font-medium text-content-muted">{summary}</span>
        </span>
        {editable && (
          <span className="shrink-0 text-content-muted">
            {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </span>
        )}
      </button>

      <div className="border-t border-line px-5 sm:px-6">
        {loading ? (
          <div className="py-1">
            {rows.map((_, i) => (
              <div key={i} className="flex items-center justify-between border-b border-line py-3.5 last:border-0">
                <Skeleton className={cn("h-3 rounded-full", ["w-24", "w-32", "w-28"][i % 3])} />
                <Skeleton className={cn("h-3 rounded-full", i % 2 ? "w-20" : "w-14")} />
              </div>
            ))}
          </div>
        ) : (
          <AnimatePresence initial={false} mode="wait">
            {expanded && editable ? (
              <motion.div
                key="edit"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-5"
              >
                {children}
              </motion.div>
            ) : (
              <motion.div key="rows" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
                    <span className="shrink-0 text-[13px] font-medium text-content-muted">{r.label}</span>
                    <span className={cn(
                      "min-w-0 break-words text-right text-[14.5px] font-semibold text-content",
                      r.money && "ui-tnum",
                      r.muted && "font-normal text-content-faint",
                    )}>
                      {r.value}
                    </span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </Surface>
  );
}

// ─── NavCard — a settings row that navigates somewhere ───────────────────────

function NavCard({
  eyebrow, icon, label, sub, onClick,
}: { eyebrow: string; icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <Surface pad="none" interactive className="group">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-touch w-full items-center gap-3.5 px-5 py-4 text-left sm:px-6"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-brand-soft text-brand">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-bold uppercase tracking-[0.11em] text-content-muted">{eyebrow}</span>
          <span className="mt-0.5 block font-editorial text-[19px] font-bold leading-[1.15] tracking-[-0.018em] text-content transition-colors group-hover:text-[rgb(var(--ui-brand-ink))]">{label}</span>
          {sub && <span className="mt-0.5 block text-[12.5px] font-medium text-content-muted">{sub}</span>}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5 group-hover:text-[rgb(var(--ui-brand-ink))]" />
      </button>
    </Surface>
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

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {features.map((f) => (
        <li key={f} className="flex items-center gap-2 text-[13px] text-content-secondary">
          <Check className="h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2.5} /> {f}
        </li>
      ))}
    </ul>
  );
}

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

  const summary = isPro
    ? cancelScheduled
      ? (periodLabel ?? "Cancels at period end")
      : `${(status?.subscriptionStatus ?? "active").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}${periodLabel ? ` · ${periodLabel}` : ""}`
    : `${FREE_FEATURES.join(" · ")}`;

  return (
    <Surface pad="none" className="overflow-hidden">
      <div className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-brand-soft text-brand">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-bold uppercase tracking-[0.11em] text-content-muted">Plan</span>
          <span className="mt-0.5 block font-editorial text-[19px] font-bold leading-[1.15] tracking-[-0.018em] text-content">
            {isPro ? "Pro" : "Free plan"}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] font-medium text-content-muted">{summary}</span>
        </div>
        {isPro && !cancelScheduled && <Badge tone="brand" size="sm">Active</Badge>}
        {isPro && cancelScheduled && <Badge tone="caution" size="sm">Canceling</Badge>}
      </div>

      <div className="border-t border-line px-5 py-5 sm:px-6">
        {welcome && (
          <Alert tone="positive" className="mb-4">
            Welcome to Pro! Your account is being upgraded.
          </Alert>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className={cn("h-3 rounded-full", ["w-32", "w-36", "w-40"][i])} />
                <Skeleton className="h-3 w-12 rounded-full" />
              </div>
            ))}
          </div>
        ) : isPro ? (
          <div className="flex flex-col items-start gap-5">
            <FeatureList features={PRO_FEATURES} />
            {cancelScheduled && periodDate && (
              <p className="text-[13px] leading-relaxed text-content-muted">
                Your subscription is set to cancel on {periodDate}. You'll keep Pro until then —
                reactivate any time from Manage subscription.
              </p>
            )}
            <Button variant="secondary" onClick={handleManage} disabled={managing} loading={managing}>
              {managing ? "Redirecting…" : "Manage subscription"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-5">
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-ui-md border border-line p-4">
                <p className="mb-2.5 text-[13px] font-bold text-content">Free</p>
                <FeatureList features={FREE_FEATURES} />
              </div>
              <div className="rounded-ui-md border border-transparent bg-brand-soft p-4">
                <p className="mb-2.5 text-[13px] font-bold text-[rgb(var(--ui-brand-ink))]">Pro · $11.99/mo</p>
                <FeatureList features={PRO_FEATURES} />
              </div>
            </div>
            <Button onClick={handleUpgrade} disabled={upgrading} loading={upgrading} leadingIcon={<Sparkles className="h-4 w-4" />}>
              {upgrading ? "Redirecting…" : "Upgrade to Pro"}
            </Button>
          </div>
        )}

        {error && <p className="mt-3 text-[13px] font-semibold text-negative">{error}</p>}
      </div>
    </Surface>
  );
}

// ─── Switch — brand toggle ───────────────────────────────────────────────────

function Switch({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="ui-focus flex min-h-touch w-full items-center gap-3 rounded-ui-md text-left"
    >
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 ease-ui",
          checked ? "bg-brand" : "bg-canvas-sunken border border-line-strong",
        )}
      >
        <span
          className={cn(
            "inline-block h-[18px] w-[18px] rounded-full bg-white shadow-ui-sm transition-transform duration-150 ease-ui",
            checked ? "translate-x-[23px]" : "translate-x-[3px]",
          )}
        />
      </span>
      <span className="text-[13.5px] font-medium text-content-secondary">{label}</span>
    </button>
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

function PersonalEditPanel({ formData, setFormData, saving, onCancel, onSave }: EditPanelProps) {
  // Inline validation (visual only — never blocks save, matching prior behavior).
  const stateError = formData.stateOfResidence.length === 1 ? "Use a 2-letter code" : undefined;
  const retAgeNum = Number(formData.retirementAge);
  const retAgeError = formData.retirementAge && (retAgeNum < 30 || retAgeNum > 100) ? "Between 30 and 100" : undefined;
  const depNum = Number(formData.dependentCount);
  const depError = formData.dependentCount && (depNum < 0 || depNum > 10) ? "Between 0 and 10" : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Field label="Date of birth">
        <Input
          type="date"
          value={formData.dateOfBirth}
          onChange={(e) => setFormData((f) => ({ ...f, dateOfBirth: e.target.value }))}
        />
      </Field>

      <Field label="Filing status">
        <Select
          value={formData.filingStatus}
          onChange={(e) => setFormData((f) => ({ ...f, filingStatus: e.target.value }))}
        >
          <option value="">Select…</option>
          {FILING_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="State of residence" hint="2-letter code" error={stateError}>
        <Input
          type="text"
          maxLength={2}
          invalid={!!stateError}
          value={formData.stateOfResidence}
          onChange={(e) => setFormData((f) => ({ ...f, stateOfResidence: e.target.value }))}
          placeholder="CA"
          className="uppercase"
        />
      </Field>

      <Field label="Risk tolerance">
        <Select
          value={formData.riskTolerance}
          onChange={(e) => setFormData((f) => ({ ...f, riskTolerance: e.target.value }))}
        >
          <option value="">Select…</option>
          {RISK_TOLERANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="Retirement age" error={retAgeError}>
        <Input
          type="number"
          min={30}
          max={100}
          invalid={!!retAgeError}
          value={formData.retirementAge}
          onChange={(e) => setFormData((f) => ({ ...f, retirementAge: e.target.value }))}
          placeholder="65"
          className="ui-tnum"
        />
      </Field>

      <Field label="Number of dependents" error={depError}>
        <Input
          type="number"
          min={0}
          max={10}
          invalid={!!depError}
          value={formData.dependentCount}
          onChange={(e) => setFormData((f) => ({ ...f, dependentCount: e.target.value }))}
          placeholder="0"
          className="ui-tnum"
        />
      </Field>

      <div className="flex flex-col gap-1 rounded-ui-md bg-canvas-sunken px-4 py-2">
        <Switch
          checked={formData.hasHDHP}
          onChange={(v) => setFormData((f) => ({ ...f, hasHDHP: v }))}
          label="Enrolled in a high-deductible health plan (HDHP)"
        />
        <Switch
          checked={formData.isPSLFEligible}
          onChange={(v) => setFormData((f) => ({ ...f, isPSLFEligible: v }))}
          label="Work in public service (PSLF eligible)"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={onSave} disabled={saving} loading={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function IncomeEditPanel({ formData, setFormData, saving, onCancel, onSave }: EditPanelProps) {
  const matchNum = Number(formData.employerMatchPercent);
  const matchError = formData.employerMatchPercent && (matchNum < 0 || matchNum > 100) ? "Between 0 and 100" : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Field label="Employment type">
        <Select
          value={formData.employmentType}
          onChange={(e) => setFormData((f) => ({ ...f, employmentType: e.target.value }))}
        >
          <option value="w2">W2 employee</option>
          <option value="self_employed">Self-employed</option>
          <option value="1099">1099 / contractor</option>
          <option value="business_owner">Business owner</option>
        </Select>
      </Field>

      <Field label="Annual gross income">
        <Input
          type="number"
          min={0}
          step={1000}
          value={formData.annualIncome}
          onChange={(e) => setFormData((f) => ({ ...f, annualIncome: e.target.value }))}
          placeholder="72000"
          className="ui-tnum"
          leadingIcon={<span className="text-[13px]">$</span>}
        />
      </Field>

      <Field label="Employer match (%)" error={matchError}>
        <Input
          type="number"
          min={0}
          max={100}
          step={0.5}
          invalid={!!matchError}
          value={formData.employerMatchPercent}
          onChange={(e) => setFormData((f) => ({ ...f, employerMatchPercent: e.target.value }))}
          placeholder="4"
          className="ui-tnum"
        />
      </Field>

      <div className="flex gap-2 pt-1">
        <Button onClick={onSave} disabled={saving} loading={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
