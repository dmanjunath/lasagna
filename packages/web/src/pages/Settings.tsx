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
  Pencil,
  LogOut,
  Sparkles,
  Check,
  Fingerprint,
  Trash2,
} from "lucide-react";
import { useConfirm } from "../components/ds";
import { isNativeApp } from "../lib/native";
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

  // Show a "Welcome to Pro" banner at the top of the page after a successful
  // upgrade redirect (?upgraded=1). Billing status refresh is handled in PlanCard.
  const [showProWelcome, setShowProWelcome] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgraded") === "1") {
      setShowProWelcome(true);
    }
  }, []);

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

  const personalRows: DetailRow[] = [
    { label: "Date of birth", value: profile?.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : "Not set", muted: !profile?.dateOfBirth },
    { label: "Age", value: age, muted: age === "Not set" },
    { label: "Filing status", value: filingStatus, muted: !profile?.filingStatus },
    { label: "State of residence", value: state, muted: state === "Not set" },
    { label: "Risk tolerance", value: riskTolerance, muted: !profile?.riskTolerance },
    { label: "Dependents", value: dependents, muted: dependents === "Not set" },
  ];

  const incomeRows: DetailRow[] = [
    { label: "Gross income", value: grossIncome, muted: grossIncome === "Not set", money: true },
    { label: "Employment type", value: formatEmployment(employmentType), muted: employmentType === "Not set" },
    { label: "Employer match", value: employerMatch, muted: employerMatch === "Not set", money: true },
    { label: "Retirement age", value: retirementAge, muted: retirementAge === "Not set", money: true },
  ];

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "U";

  return (
    <div className="mx-auto max-w-[840px] px-3 sm:px-11 pt-3 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Identity header ════════ */}
      <header className="animate-fade-in flex flex-col gap-5 border-b border-line pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="grid h-14 w-14 shrink-0 place-items-center rounded-ui-lg bg-[var(--ui-accent-soft)] font-editorial text-[22px] font-bold tracking-tight text-[rgb(var(--ui-accent-ink))] ring-1 ring-inset ring-[var(--ui-accent-soft)]"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <Eyebrow>Your profile</Eyebrow>
            <h1 className="mt-1 truncate font-editorial text-[26px] sm:text-[32px] font-bold leading-[1.04] tracking-[-0.026em] text-content">
              {displayName}
            </h1>
            {email && (
              <p className="mt-1 truncate text-[13.5px] font-medium text-content-muted">{email}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => logout()}
          leadingIcon={<LogOut className="h-4 w-4" />}
          className="self-start sm:self-auto"
        >
          Sign out
        </Button>
      </header>

      {showProWelcome && (
        <Alert tone="positive" className="mt-6">
          Welcome to Pro! Your account is being upgraded.
        </Alert>
      )}

      {/* ════════ Financial profile ════════ */}
      <section className="mt-10">
        <GroupHeader eyebrow="Financial profile" hint="Powers your tax, retirement, and cash-flow insights" />
        <div className="mt-4 space-y-4">
          <DetailCard
            icon={<User className="h-5 w-5" />}
            title="Personal info"
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
          </DetailCard>

          <DetailCard
            icon={<Briefcase className="h-5 w-5" />}
            title="Income & employment"
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
          </DetailCard>
        </div>
      </section>

      {/* ════════ Plan & billing ════════ */}
      <section className="mt-10">
        <GroupHeader eyebrow="Plan & billing" hint="Your subscription and what's included" />
        <div className="mt-4">
          <PlanCard />
        </div>
      </section>

      {/* ════════ Security ════════ */}
      <section className="mt-10">
        <GroupHeader eyebrow="Security" hint="Sign in with Face ID, Touch ID, or a device passkey" />
        <div className="mt-4">
          <PasskeysCard />
        </div>
      </section>

      {/* ════════ Manage ════════ */}
      <section className="mt-10">
        <GroupHeader eyebrow="Manage" hint="Jump to the things you keep up to date" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NavCard
            icon={<Building2 className="h-5 w-5" />}
            label="Accounts"
            sub="Banks, brokerages, manual balances"
            onClick={() => navigate("/accounts")}
          />
          <NavCard
            icon={<Target className="h-5 w-5" />}
            label="Goals"
            sub="Targets, milestones, progress"
            onClick={() => navigate("/goals")}
          />
        </div>
      </section>
    </div>
  );
}

// ─── Passkeys card — register/list/remove Face ID / Touch ID credentials ─────

function PasskeysCard() {
  const [creds, setCreds] = useState<
    { id: string; deviceName: string | null; createdAt: string; lastUsedAt: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = useConfirm();
  const supported = typeof window !== "undefined" && !!window.PublicKeyCredential;

  const load = useCallback(async () => {
    try {
      const { credentials } = await api.listPasskeys();
      setCreds(credentials);
    } catch {
      // Non-fatal: the section just shows the add button.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addPasskey = async () => {
    setBusy(true);
    setError("");
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const options = await api.webauthnRegisterOptions();
      const response = await startRegistration({ optionsJSON: options as never });
      await api.webauthnRegisterVerify({ response });
      await load();
    } catch (err) {
      // NotAllowedError = the user dismissed the system prompt.
      if (err instanceof Error && err.name !== "NotAllowedError") setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removePasskey = async (id: string) => {
    const ok = await confirm({
      title: "Remove this passkey?",
      body: "You won't be able to sign in with it anymore. You can add it again anytime.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    await api.deletePasskey(id);
    await load();
  };

  return (
    <Surface className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-canvas-sunken text-content-muted">
            <Fingerprint className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-content">Face ID &amp; passkeys</h3>
            <p className="mt-0.5 text-[13px] font-medium text-content-muted">
              Skip the password on devices you trust.
            </p>
          </div>
        </div>
        {supported && (
          <Button variant="secondary" size="sm" onClick={addPasskey} loading={busy} disabled={busy}>
            Add passkey
          </Button>
        )}
      </div>

      {!supported && (
        <p className="mt-4 text-[13px] font-medium text-content-muted">
          This browser doesn't support passkeys.
        </p>
      )}

      {error && (
        <Alert tone="negative" className="mt-4">
          {error}
        </Alert>
      )}

      {loading ? (
        <Skeleton className="mt-4 h-10 rounded-ui-md" />
      ) : creds.length > 0 ? (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {creds.map((cr) => (
            <li key={cr.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-content">
                  {cr.deviceName || "Passkey"}
                </p>
                <p className="mt-0.5 text-[12.5px] font-medium text-content-muted">
                  Added {new Date(cr.createdAt).toLocaleDateString()}
                  {cr.lastUsedAt ? ` · Last used ${new Date(cr.lastUsedAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove passkey"
                onClick={() => removePasskey(cr.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        supported && (
          <p className="mt-4 text-[13px] font-medium text-content-muted">
            No passkeys yet — add one to sign in with Face ID on this device.
          </p>
        )
      )}
    </Surface>
  );
}

// ─── Group header — a periwinkle eyebrow over a band of cards ─────────────────

function GroupHeader({ eyebrow, hint }: { eyebrow: string; hint?: string }) {
  return (
    <div className="px-1">
      <Eyebrow>{eyebrow}</Eyebrow>
      {hint && <p className="mt-1 text-[13px] font-medium text-content-muted">{hint}</p>}
    </div>
  );
}

// ─── Detail card — icon + title + Edit, with a definition grid or edit form ──

interface DetailRow {
  label: string;
  value: string;
  muted?: boolean;
  money?: boolean;
}

interface DetailCardProps {
  icon: React.ReactNode;
  title: string;
  rows: DetailRow[];
  loading: boolean;
  editable: boolean;
  expanded: boolean;
  onEdit: () => void;
  children?: React.ReactNode;
}

function DetailCard({ icon, title, rows, loading, editable, expanded, onEdit, children }: DetailCardProps) {
  return (
    <Surface pad="none" className="overflow-hidden">
      <div className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">
          {icon}
        </span>
        <h3 className="min-w-0 flex-1 font-editorial text-[19px] font-bold leading-[1.15] tracking-[-0.018em] text-content">
          {title}
        </h3>
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-expanded={expanded}
            trailingIcon={
              expanded ? <ChevronDown className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />
            }
          >
            {expanded ? "Close" : "Edit"}
          </Button>
        )}
      </div>

      <div className="border-t border-line px-5 py-5 sm:px-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            {rows.map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-2.5 w-20 rounded-full" />
                <Skeleton className={cn("h-3.5 rounded-full", ["w-28", "w-24", "w-32", "w-20"][i % 4])} />
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
              >
                {children}
              </motion.div>
            ) : (
              <motion.div
                key="rows"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2"
              >
                {rows.map((r) => (
                  <div key={r.label} className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-content-muted">
                      {r.label}
                    </div>
                    <div
                      className={cn(
                        "mt-1 break-words text-[15.5px] font-semibold text-content",
                        r.money && "ui-tnum",
                        r.muted && "font-medium text-content-faint",
                      )}
                    >
                      {r.value}
                    </div>
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
  icon, label, sub, onClick,
}: { icon: React.ReactNode; label: string; sub?: string; onClick: () => void }) {
  return (
    <Surface pad="none" interactive className="group">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-touch w-full items-center gap-3.5 px-5 py-4 text-left sm:px-5"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-editorial text-[17px] font-bold leading-[1.15] tracking-[-0.018em] text-content transition-colors group-hover:text-[rgb(var(--ui-brand-ink))]">{label}</span>
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

function FeatureList({ features, tone = "brand" }: { features: string[]; tone?: "brand" | "accent" }) {
  const checkClass = tone === "accent" ? "text-[rgb(var(--ui-accent-ink))]" : "text-brand";
  return (
    <ul className="flex flex-col gap-2">
      {features.map((f) => (
        <li key={f} className="flex items-center gap-2 text-[13px] font-medium text-content-secondary">
          <Check className={cn("h-3.5 w-3.5 shrink-0", checkClass)} strokeWidth={2.5} /> {f}
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

  // After Stripe Checkout redirects back with ?upgraded=1, the webhook that
  // flips the plan may land a beat later — so refresh now and again shortly.
  // (The "Welcome to Pro" banner now renders at the top of the page — see Settings.)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgraded") !== "1") return;
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

  // App-store rules (Apple 3.1.1): no external purchase flows in the native
  // shell — hide Stripe checkout/portal there ("reader" pattern).
  const native = isNativeApp();
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
    : "Free plan — upgrade any time";

  return (
    <Surface pad="none" className="overflow-hidden">
      <div className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block font-editorial text-[19px] font-bold leading-[1.15] tracking-[-0.018em] text-content">
            {isPro ? "Pro" : "Free plan"}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] font-medium text-content-muted">{summary}</span>
        </div>
        {isPro && !cancelScheduled && <Badge tone="brand" size="sm">Active</Badge>}
        {isPro && cancelScheduled && <Badge tone="caution" size="sm">Canceling</Badge>}
      </div>

      <div className="border-t border-line px-5 py-5 sm:px-6">
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
            {native ? (
              <p className="text-[13px] font-medium text-content-muted">
                Manage your subscription from the web app.
              </p>
            ) : (
              <Button variant="secondary" onClick={handleManage} disabled={managing} loading={managing}>
                {managing ? "Redirecting…" : "Manage subscription"}
              </Button>
            )}
          </div>
        ) : native ? (
          <div className="flex flex-col items-start gap-3">
            <FeatureList features={FREE_FEATURES} />
            <p className="text-[13px] font-medium text-content-muted">
              Plan changes are available from the web app.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-5">
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-ui-lg border border-line bg-canvas-sunken p-4">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <p className="text-[13px] font-bold text-content">Free</p>
                  <p className="text-[12px] font-semibold text-content-muted">Current</p>
                </div>
                <FeatureList features={FREE_FEATURES} />
              </div>
              <div className="rounded-ui-lg border border-[var(--ui-accent-soft)] bg-[var(--ui-accent-soft)] p-4 ring-1 ring-inset ring-[var(--ui-accent-soft)]">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <p className="text-[13px] font-bold text-[rgb(var(--ui-accent-ink))]">Pro</p>
                  <p className="text-[12px] font-bold text-[rgb(var(--ui-accent-ink))] ui-tnum">$11.99/mo</p>
                </div>
                <FeatureList features={PRO_FEATURES} tone="accent" />
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date of birth">
          <Input
            type="date"
            value={formData.dateOfBirth}
            onChange={(e) => setFormData((f) => ({ ...f, dateOfBirth: e.target.value }))}
          />
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
      </div>

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
          {saving ? "Saving…" : "Save changes"}
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Employment type" className="sm:col-span-2">
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
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={onSave} disabled={saving} loading={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
