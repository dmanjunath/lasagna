import { formatMoney, formatStoredDate } from "./format";

// Profile & Settings (/profile), ported from packages/web/src/pages/Settings.tsx.

export type FinancialProfile = {
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

export type Option = { value: string; label: string };

export const FILING_STATUS_OPTIONS: Option[] = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married filing jointly" },
  { value: "married_separate", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_widow", label: "Qualifying widow(er)" },
];

export const RISK_TOLERANCE_OPTIONS: Option[] = [
  { value: "conservative", label: "Conservative" },
  { value: "moderate_conservative", label: "Moderate-conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "moderate_aggressive", label: "Moderate-aggressive" },
  { value: "aggressive", label: "Aggressive" },
];

export const EMPLOYMENT_OPTIONS: Option[] = [
  { value: "w2", label: "W2 employee" },
  { value: "self_employed", label: "Self-employed" },
  { value: "1099", label: "1099 / contractor" },
  { value: "business_owner", label: "Business owner" },
];

export const NOT_SET = "Not set";

export const labelOf = (options: Option[], value: string | null | undefined): string =>
  value ? (options.find((o) => o.value === value)?.label ?? value) : NOT_SET;

export type DetailRow = { label: string; value: string; muted: boolean };

const row = (label: string, value: string | null): DetailRow => ({ label, value: value ?? NOT_SET, muted: value === null });

/** Personal info as label and value rows. "Not set" rows are muted. */
export function personalRows(p: FinancialProfile | null): DetailRow[] {
  return [
    row("Date of birth", p?.dateOfBirth ? formatStoredDate(p.dateOfBirth, { month: "long", day: "numeric", year: "numeric" }) : null),
    row("Age", p?.age != null ? String(p.age) : null),
    row("Retirement age", p?.retirementAge != null ? String(p.retirementAge) : null),
    row("Filing status", p?.filingStatus ? labelOf(FILING_STATUS_OPTIONS, p.filingStatus) : null),
    row("State of residence", p?.stateOfResidence || null),
    row("Risk tolerance", p?.riskTolerance ? labelOf(RISK_TOLERANCE_OPTIONS, p.riskTolerance) : null),
    row("Dependents", p?.dependentCount != null ? String(p.dependentCount) : null),
  ];
}

/** Income and employment as rows. The income honors hide amounts. */
export function incomeRows(p: FinancialProfile | null): DetailRow[] {
  return [
    row("Gross income", p?.annualIncome != null ? `${formatMoney(p.annualIncome, true)}/yr` : null),
    row("Employment type", p?.employmentType ? labelOf(EMPLOYMENT_OPTIONS, p.employmentType) : null),
    row("Employer match", p?.employerMatchPercent != null ? `${p.employerMatchPercent}%` : null),
  ];
}

export type ProfileForm = {
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

/** The edit form, from the stored profile (the web's openEdit). */
export function formFrom(p: FinancialProfile | null): ProfileForm {
  return {
    dateOfBirth: p?.dateOfBirth ? p.dateOfBirth.split("T")[0] : "",
    annualIncome: p?.annualIncome?.toString() ?? "",
    filingStatus: p?.filingStatus ?? "",
    stateOfResidence: p?.stateOfResidence ?? "",
    riskTolerance: p?.riskTolerance ?? "",
    employerMatchPercent: p?.employerMatchPercent?.toString() ?? "",
    retirementAge: p?.retirementAge?.toString() ?? "",
    employmentType: p?.employmentType ?? "w2",
    dependentCount: p?.dependentCount?.toString() ?? "",
    hasHDHP: p?.hasHDHP ?? false,
    isPSLFEligible: p?.isPSLFEligible ?? false,
  };
}

export type ProfileSection = "personal" | "income";

/** What Save sends for a section, exactly as the web's handleSave builds it. */
export function updatesFor(section: ProfileSection, f: ProfileForm): Partial<FinancialProfile> {
  if (section === "personal") {
    return {
      dateOfBirth: f.dateOfBirth || null,
      filingStatus: f.filingStatus || null,
      stateOfResidence: f.stateOfResidence.toUpperCase() || null,
      riskTolerance: f.riskTolerance || null,
      retirementAge: f.retirementAge ? Number(f.retirementAge) : null,
      dependentCount: f.dependentCount !== "" ? Number(f.dependentCount) : null,
      hasHDHP: f.hasHDHP,
      isPSLFEligible: f.isPSLFEligible,
    };
  }
  return {
    annualIncome: f.annualIncome ? Number(f.annualIncome) : null,
    employerMatchPercent: f.employerMatchPercent ? Number(f.employerMatchPercent) : null,
    employmentType: f.employmentType || null,
  };
}

/** The latest birth date of someone 18 today, as YYYY-MM-DD. */
export function latestAdultBirthDate(today: Date = new Date()): string {
  const y = today.getFullYear() - 18;
  const m = today.getMonth() + 1;
  const d = Math.min(today.getDate(), new Date(y, m, 0).getDate());
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Each field's problem, if any. `blocking` keeps Save off (the web blocks only on the birth date). */
export function formErrors(section: ProfileSection, f: ProfileForm, today: Date = new Date()) {
  const e: Partial<Record<keyof ProfileForm, string>> = {};
  if (section === "personal") {
    if (f.stateOfResidence.length === 1) e.stateOfResidence = "Use a 2-letter state code.";
    const ret = Number(f.retirementAge);
    if (f.retirementAge && (Number.isNaN(ret) || ret < 30 || ret > 100)) e.retirementAge = "Retirement age is between 30 and 100.";
    const dep = Number(f.dependentCount);
    if (f.dependentCount && (Number.isNaN(dep) || dep < 0 || dep > 10)) e.dependentCount = "Dependents is between 0 and 10.";
    if (f.dateOfBirth && f.dateOfBirth > latestAdultBirthDate(today)) e.dateOfBirth = "You need to be 18 or older to use LasagnaFi.";
  } else {
    const m = Number(f.employerMatchPercent);
    if (f.employerMatchPercent && (Number.isNaN(m) || m < 0 || m > 100)) e.employerMatchPercent = "Employer match is between 0 and 100%.";
  }
  return { errors: e, blocking: !!e.dateOfBirth };
}

/** Digits only, for a whole-number field. */
export const wholeNumber = (v: string) => v.replace(/[^\d]/g, "");
/** Digits and one decimal point, for a percent. */
export function decimalNumber(v: string): string {
  const clean = v.replace(/[^\d.]/g, "");
  const i = clean.indexOf(".");
  return i < 0 ? clean : `${clean.slice(0, i + 1)}${clean.slice(i + 1).replace(/\./g, "")}`;
}

/** Initials for the identity tile: up to two words' first letters. */
export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "U"
  );
}

/** Deleting is owner-only, never for a demo or operator account (the web's canDeleteAccount). */
export function canDeleteAccount(user: { isDemo?: boolean; isAdmin: boolean; role: string } | null, demoBuild: boolean): boolean {
  return !demoBuild && !!user && !user.isDemo && !user.isAdmin && user.role === "owner";
}

export const PRO_FEATURES = ["Up to 50 connected institutions", 'Manual "Sync now"', "Premium AI models"];
export const FREE_FEATURES = ["Up to 2 connected institutions", "Daily auto-sync", "Basic AI model"];
export const PRO_PRICE = "$11.99/mo";

type Billing = { plan: "free" | "pro"; subscriptionStatus: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** The plan's one-line summary, as the web's PlanCard says it. */
export function planSummary(s: Billing): string {
  if (s.plan !== "pro") return "Upgrade any time";
  const date = s.currentPeriodEnd ? longDate(s.currentPeriodEnd) : null;
  if (s.cancelAtPeriodEnd) return date ? `Cancels ${date}` : "Cancels at period end";
  const status = (s.subscriptionStatus ?? "active").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return date ? `${status}, renews ${date}` : status;
}

/** A pending invite's line: when it expires, or that it has. */
export function inviteLine(expiresAt: string, now: number = Date.now()): { text: string; expired: boolean } {
  const expired = new Date(expiresAt).getTime() < now;
  const on = new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return { text: expired ? `Expired ${on}` : `Pending, expires ${on}`, expired };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A moment to the minute ("Nov 22, 2026, 6:41 PM"), or null. */
export function exactTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The Settings sections, each a pushed sub-screen. */
export const PROFILE_SECTIONS = ["personal", "income", "household", "billing", "security", "preferences"] as const;
export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number];

export const SECTION_TITLE: Record<ProfileSectionId, string> = {
  personal: "Personal info",
  income: "Income & employment",
  household: "Household",
  billing: "Plan & billing",
  security: "Security",
  preferences: "Preferences",
};
