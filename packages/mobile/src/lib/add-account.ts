import { accountTypesIn, type AccountTypeOption } from "@web/lib/account-types";

// The by-hand add forms of packages/web/src/components/accounts/useAccountConnections.tsx:
// one for anything with a balance, one for a property, and the create body
// each sends.

export type AddFormKind = "manual" | "property";

export const ADD_FORMS: Record<AddFormKind, { title: string; typeLabel: string; types: AccountTypeOption[] }> = {
  manual: {
    title: "Add a balance manually",
    typeLabel: "Account type",
    types: [...accountTypesIn("bank"), ...accountTypesIn("other"), ...accountTypesIn("debt")],
  },
  property: { title: "Add a property", typeLabel: "Property type", types: accountTypesIn("realEstate") },
};

/** The form and type a deep link (?add=<type>[:<subtype>]) names. A link without a subtype opens the form with no type chosen. */
export function formForType(add: string): { kind: AddFormKind; type: AccountTypeOption | null } | null {
  const [type, subtype = null] = add.split(":");
  for (const kind of ["manual", "property"] as const) {
    const exact = ADD_FORMS[kind].types.find((t) => t.type === type && t.subtype === subtype);
    if (exact) return { kind, type: exact };
  }
  for (const kind of ["manual", "property"] as const) {
    const types = ADD_FORMS[kind].types;
    if (types.some((t) => t.type === type)) return { kind, type: types.length === 1 ? types[0] : null };
  }
  return null;
}

/** A monthly payment is asked for on an amortising loan only. */
export const asksMinPayment = (t: AccountTypeOption) => t.type === "loan" && t.subtype !== "mortgage";
/** A property links to its mortgage, a mortgage to its property. */
export const offersLink = (t: Pick<AccountTypeOption, "type" | "subtype">) => t.type === "real_estate" || t.subtype === "mortgage";

export interface AddForm {
  name: string;
  balance: string;
  rate: string;
  minPayment: string;
  rent: string;
  insurance: string;
  maintenance: string;
  address: string;
  placeId: string;
  lat: number | null;
  lng: number | null;
  valueSource: "market" | "own";
  linkedId: string;
}

export const EMPTY_ADD_FORM: AddForm = {
  name: "",
  balance: "",
  rate: "",
  minPayment: "",
  rent: "",
  insurance: "",
  maintenance: "",
  address: "",
  placeId: "",
  lat: null,
  lng: null,
  valueSource: "market",
  linkedId: "",
};

/** POST /manual-accounts's body, as the web builds it. */
export function createBody(type: AccountTypeOption, f: AddForm) {
  const isProperty = type.type === "real_estate";
  const own = isProperty && f.valueSource === "own";
  const hasValue = isProperty ? own && f.balance.trim() !== "" : f.balance.trim() !== "";
  const typed = f.rate.trim() !== "" ? Number(f.rate) : NaN;
  const rate = Number.isFinite(typed) && typed >= 0 && typed <= 99.99 ? typed : null;
  const metadata: Record<string, unknown> = {};
  if (type.isDebt) {
    const loanType = type.type === "credit" ? "credit_card" : type.subtype === "mortgage" ? "mortgage" : type.subtype === "student" ? "student_loan" : "other_loan";
    metadata.type = loanType;
    metadata.source = "manual";
    if (rate !== null) {
      if (loanType === "credit_card") metadata.aprs = [{ aprType: "purchase_apr", aprPercentage: rate }];
      else metadata.interestRatePercentage = rate;
    }
    const minPay = f.minPayment.trim() !== "" ? Number(f.minPayment) : NaN;
    if (asksMinPayment(type) && Number.isFinite(minPay) && minPay >= 0) metadata.minimumPaymentAmount = minPay;
  }
  if (type.subtype === "rental") {
    if (f.rent) metadata.monthlyRent = parseFloat(f.rent);
    if (f.insurance) metadata.annualInsurance = parseFloat(f.insurance);
    if (f.maintenance) metadata.annualMaintenance = parseFloat(f.maintenance);
  }
  if (isProperty && f.address.trim()) {
    metadata.address = f.address.trim();
    if (f.placeId) metadata.placeId = f.placeId;
    if (f.lat !== null) metadata.lat = f.lat;
    if (f.lng !== null) metadata.lng = f.lng;
  }
  const willEstimate = isProperty && !hasValue && f.address.trim() !== "";
  return {
    name: f.name.trim(),
    type: type.type,
    ...(type.subtype ? { subtype: type.subtype } : {}),
    balance: hasValue ? parseFloat(f.balance) : willEstimate ? undefined : 0,
    ...(type.isDebt && rate !== null ? { apr: rate } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    ...(own ? { valueSource: "own" as const } : {}),
    ...(f.linkedId ? { linkedAccountId: f.linkedId } : {}),
  };
}

const ADD_ERROR_COPY: Record<string, string> = {
  name: "That name is too long. Try a shorter one.",
  apr: "Enter a rate between 0 and 99.99.",
  type: "Choose an account type.",
  subtype: "Choose an account type.",
};

/** The create route's 400s, in the words of the field. */
export function friendlyAddError(raw: string | undefined): string {
  const field = raw?.match(/^(\w+) must /)?.[1];
  return (field && ADD_ERROR_COPY[field]) || "We couldn't add this account. Try again.";
}

/** Digits and one decimal point, as a money field accepts them. */
export const moneyInput = (s: string) => s.replace(/[^0-9.]/g, "");
