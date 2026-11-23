import { ACCOUNT_TYPE_CATALOG, accountTypeLabel, canonicalSubtype, type AccountTypeOption } from "@web/lib/account-types";
import { isDebtType, type ItemAccount } from "./account-list";

// The account's settings, ported from packages/web/src/pages/account-detail.tsx:
// what the form starts from, what the detail page reads off the stored
// account, and the requests Save makes (only for what changed).

export type LoanType = "mortgage" | "student_loan" | "credit_card" | "other_loan";
export type ValueChoice = "market" | "own";
type TypeOption = Pick<AccountTypeOption, "label" | "type" | "subtype">;

export const typeKey = (type: string, subtype: string | null | undefined) => `${type}:${subtype ?? ""}`;

const metaOf = (a: ItemAccount) => (a.metadata ?? {}) as Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? String(v) : typeof v === "string" ? v : "");
export const metaNum = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;

/** The loan shape the loan-details PATCH and the debt page read. */
export function loanTypeOf(a: Pick<ItemAccount, "type" | "subtype" | "name">): LoanType {
  const lower = a.name.toLowerCase();
  if (a.type === "credit") return "credit_card";
  if (a.subtype === "mortgage" || lower.includes("mortgage")) return "mortgage";
  if (a.subtype === "student" || a.subtype === "student_loan" || lower.includes("student")) return "student_loan";
  return "other_loan";
}

/**
 * The type choices for this account. A synced type the catalog doesn't list
 * leads the list, so saving never quietly reclassifies it. A catalogued one
 * keeps its stored spelling ("credit card" stays as Plaid sent it).
 */
export function typeOptionsFor(a: Pick<ItemAccount, "type" | "subtype">): TypeOption[] {
  const known = typeKey(a.type, canonicalSubtype(a.subtype));
  const isKnown = ACCOUNT_TYPE_CATALOG.some((o) => typeKey(o.type, o.subtype) === known);
  return isKnown
    ? ACCOUNT_TYPE_CATALOG.map((o) => (typeKey(o.type, o.subtype) === known ? { ...o, subtype: a.subtype ?? null } : o))
    : [{ label: accountTypeLabel(a.type, a.subtype), type: a.type, subtype: a.subtype }, ...ACCOUNT_TYPE_CATALOG];
}

export interface EditForm {
  name: string;
  typeKey: string;
  excludeFromNetWorth: boolean;
  excludeTransactions: boolean;
  invertBalance: boolean;
  /** Manual accounts: the value, unsigned for a debt. */
  value: string;
  interestRate: string;
  minPayment: string;
  originationDate: string;
  loanTermYears: string;
  repaymentPlanType: string;
  purchaseApr: string;
  linkedPropertyId: string;
  address: string;
  placeId: string;
  lat: string;
  lng: string;
  monthlyRent: string;
  annualInsurance: string;
  annualMaintenance: string;
  valueSource: ValueChoice;
  ownValue: string;
}

export function editFormFrom(a: ItemAccount): EditForm {
  const meta = metaOf(a);
  const apr = a.apr != null ? String(a.apr) : "";
  const stored = a.balance != null ? parseFloat(a.balance) : NaN;
  const purchase = Array.isArray(meta.aprs)
    ? (meta.aprs as Array<{ aprType?: string; aprPercentage?: number }>).find((x) => x.aprType === "purchase_apr")?.aprPercentage
    : undefined;
  const ve = (meta.valueEstimate ?? {}) as Record<string, unknown>;
  const own = ve.override === true;
  return {
    name: a.name,
    typeKey: typeKey(a.type, a.subtype),
    excludeFromNetWorth: !!a.excludeFromNetWorth,
    excludeTransactions: !!a.excludeTransactions,
    invertBalance: !!a.invertBalance,
    value: Number.isNaN(stored) ? "" : (isDebtType(a.type) ? Math.abs(stored) : stored).toFixed(2),
    interestRate: num(meta.interestRatePercentage) || apr,
    minPayment: num(meta.minimumPaymentAmount),
    originationDate: typeof meta.originationDate === "string" ? meta.originationDate.slice(0, 10) : "",
    loanTermYears: num(meta.loanTermYears),
    repaymentPlanType: typeof meta.repaymentPlanType === "string" ? meta.repaymentPlanType : "",
    purchaseApr: (purchase !== undefined ? String(purchase) : "") || apr,
    linkedPropertyId: a.propertyAccountId ?? "",
    address: typeof meta.address === "string" ? meta.address : "",
    placeId: typeof meta.placeId === "string" ? meta.placeId : "",
    lat: num(meta.lat),
    lng: num(meta.lng),
    monthlyRent: num(meta.monthlyRent),
    annualInsurance: num(meta.annualInsurance),
    annualMaintenance: num(meta.annualMaintenance),
    valueSource: own ? "own" : "market",
    ownValue: own && a.balance != null ? parseFloat(a.balance).toFixed(2) : "",
  };
}

const LOAN_KEYS = ["interestRate", "minPayment", "originationDate", "loanTermYears", "repaymentPlanType", "purchaseApr"] as const;
const PROPERTY_KEYS = ["address", "placeId", "lat", "lng", "monthlyRent", "annualInsurance", "annualMaintenance"] as const;

export interface SavePlan {
  /** PATCH /manual-accounts/:id { balance }, when a manual value changed. */
  manualBalance?: number;
  /** PATCH /accounts/:id. Always sent, as the web does. */
  update: Record<string, unknown>;
  /** PATCH /accounts/:id/loan-details, when a loan field changed. */
  loan?: Record<string, unknown>;
  /** PATCH /accounts/:id/property-details, when a property field changed. */
  property?: Record<string, unknown>;
  /** The type moves the account between assets and debt. */
  crossesBucket: boolean;
  /** A new address on the market estimate: the value will be re-estimated. */
  reEstimates: boolean;
}

export function savePlan(a: ItemAccount, isManual: boolean, form: EditForm, initial: EditForm): SavePlan {
  const options = typeOptionsFor(a);
  const chosen = options.find((o) => typeKey(o.type, o.subtype) === form.typeKey) ?? options[0];
  const liability = isDebtType(a.type);
  const property = a.type === "real_estate";
  const plan: SavePlan = {
    update: {
      type: chosen.type,
      subtype: chosen.subtype,
      excludeFromNetWorth: form.excludeFromNetWorth,
      excludeTransactions: form.excludeTransactions,
      invertBalance: form.invertBalance,
      ...(form.name.trim() && form.name.trim() !== a.name ? { name: form.name.trim() } : {}),
      ...(liability && form.linkedPropertyId !== initial.linkedPropertyId ? { propertyAccountId: form.linkedPropertyId || null } : {}),
    },
    crossesBucket: liability !== isDebtType(chosen.type),
    reEstimates: property && form.valueSource === "market" && !!form.address.trim() && form.address.trim() !== initial.address.trim(),
  };

  if (isManual && !property) {
    const stored = parseFloat(a.balance ?? "0");
    const typed = parseFloat(form.value);
    const next = liability && stored < 0 ? -Math.abs(typed) : typed;
    if (!Number.isNaN(next) && next !== stored) plan.manualBalance = next;
  }

  if (liability && LOAN_KEYS.some((k) => form[k] !== initial[k])) {
    const loanType = loanTypeOf(a);
    const numOr0 = (s: string) => (s.trim() === "" ? 0 : parseFloat(s));
    const term = parseInt(form.loanTermYears, 10);
    const body: Record<string, unknown> = { type: loanType };
    const dates = () => {
      if (form.originationDate) body.originationDate = form.originationDate;
      if (Number.isFinite(term) && term > 0) body.loanTermYears = term;
    };
    if (loanType === "credit_card") {
      body.minimumPaymentAmount = numOr0(form.minPayment);
      body.aprs = [{ aprType: "purchase_apr", aprPercentage: numOr0(form.purchaseApr) }];
    } else {
      body.interestRatePercentage = numOr0(form.interestRate);
      if (loanType !== "mortgage") body.minimumPaymentAmount = numOr0(form.minPayment);
      dates();
      if (loanType === "student_loan" && form.repaymentPlanType) body.repaymentPlanType = form.repaymentPlanType;
    }
    plan.loan = body;
  }

  if (property) {
    const body: Record<string, unknown> = {};
    for (const k of PROPERTY_KEYS) {
      if (form[k] === initial[k]) continue;
      const v = form[k].trim();
      body[k] = v === "" ? null : k === "address" || k === "placeId" ? v : parseFloat(v);
    }
    const sourceChanged = form.valueSource !== initial.valueSource;
    if (form.valueSource === "own") {
      const own = parseFloat(form.ownValue);
      const ownChanged = form.ownValue.trim() !== "" && own !== parseFloat(a.balance ?? "0");
      if (sourceChanged || ownChanged) {
        body.valueSource = "own";
        if (!Number.isNaN(own)) body.ownValue = own;
      }
    } else if (sourceChanged) {
      body.valueSource = "market";
    }
    if (Object.keys(body).length > 0) plan.property = body;
  }
  return plan;
}

/** The read-only facts the detail page lists, off the stored account. */
/** The loan's facts. `figure`: a number (the rate), set in figures like the money beside it. */
export function loanFacts(a: ItemAccount): Array<{ label: string; value: string; money?: number; figure?: boolean }> {
  const meta = metaOf(a);
  const loanType = loanTypeOf(a);
  const card = loanType === "credit_card";
  const monthOf = (v: unknown) => {
    if (typeof v !== "string") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const purchase = Array.isArray(meta.aprs)
    ? (meta.aprs as Array<{ aprType?: string; aprPercentage?: number }>).find((x) => x.aprType === "purchase_apr")?.aprPercentage
    : undefined;
  const rate = card ? (purchase ?? metaNum(a.apr)) : (metaNum(meta.interestRatePercentage) ?? metaNum(a.apr));
  const minPay = metaNum(meta.minimumPaymentAmount);
  const term = metaNum(meta.loanTermYears);
  const derivedPayoff = (() => {
    if (typeof meta.originationDate !== "string" || term == null || term <= 0) return null;
    const d = new Date(meta.originationDate);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCFullYear(d.getUTCFullYear() + Math.round(term));
    return monthOf(d.toISOString());
  })();
  const payoff = monthOf(meta.maturityDate) ?? monthOf(meta.expectedPayoffDate) ?? derivedPayoff;
  const out: Array<{ label: string; value: string; money?: number; figure?: boolean }> = [];
  if (rate != null) out.push({ label: card ? "Purchase APR" : "Interest rate", value: `${rate}%`, figure: true });
  if (minPay != null) out.push({ label: card ? "Minimum payment" : "Monthly payment", value: "", money: minPay });
  if (!card) {
    const orig = monthOf(meta.originationDate);
    if (orig) out.push({ label: "Originated", value: orig });
    if (term != null && term > 0) out.push({ label: "Term", value: `${term} year${term === 1 ? "" : "s"}` });
  }
  if (loanType === "student_loan" && typeof meta.repaymentPlanType === "string" && meta.repaymentPlanType) {
    out.push({ label: "Repayment plan", value: meta.repaymentPlanType });
  }
  if (payoff) out.push({ label: card ? "Due" : "Payoff", value: payoff });
  return out;
}

/** Which loan fields the form asks for. */
export function loanFields(loanType: LoanType) {
  const card = loanType === "credit_card";
  return {
    interestRate: !card,
    purchaseApr: card,
    originationDate: !card,
    loanTermYears: !card,
    minPayment: loanType !== "mortgage",
    repaymentPlanType: loanType === "student_loan",
  };
}
