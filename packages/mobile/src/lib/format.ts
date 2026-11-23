import { HIDDEN_AMOUNT, isAmountsHidden } from "./hide-amounts";

// Ported from packages/web/src/lib/utils.ts. Stored dates are midnight UTC and
// name a calendar day, so they format in UTC. Moments use the viewer's zone.

export function formatMoney(value: number | string | null | undefined, compact = false): string {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "—";
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  })
    .format(num)
    .replace(/^-/, "−");
}

export function formatCurrencyExact(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * A stored timestamp as a Date. Also reads the Postgres text form the summary
 * sends ("2026-06-01 09:00:00+00"), which Hermes cannot parse as is.
 */
export function parseStored(iso: string): Date {
  const pg = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(iso);
  return new Date(pg ? `${pg[1]}T${pg[2]}${pg[3]}:${pg[4] ?? "00"}` : iso);
}

export function formatStoredDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = parseStored(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function formatStoredDay(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return formatStoredDate(iso, { month: "short", day: "numeric", ...opts });
}

/** A stored date as the month it falls in, e.g. "Apr 2026". */
export function formatStoredMonth(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return formatStoredDate(iso, { month: "short", year: "numeric", ...opts });
}

export function storedDayKey(iso: string): string {
  const d = parseStored(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

export function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Today", "Yesterday", or the stored day (with the year when it isn't this year). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const day = storedDayKey(iso);
  if (day === localDayKey(now)) return "Today";
  if (day === localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return "Yesterday";
  const sameYear = day.slice(0, 4) === String(now.getFullYear());
  return formatStoredDay(iso, sameYear ? undefined : { year: "numeric" });
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const USD_EXACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A typed amount in a form field, as money ("14753.39" to "$14,753.39"), for
 * while the field isn't being edited. Left as typed when it isn't a number.
 * Not masked by hide-amounts: it is the value being edited.
 */
export function moneyDisplay(value: string): string {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return value.trim() === "" || !Number.isFinite(n) ? value : USD_EXACT.format(n);
}
