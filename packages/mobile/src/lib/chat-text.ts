// Text rules for the chat screens, ported from the web's chat components
// (use-global-chat.ts, chat-thread-list.tsx) with Jest tests.

/** The plain text of an answer, for a one-line preview (use-global-chat.ts stripMarkdown). */
export function stripMarkdown(text: string): string {
  return hideIdCitations(text)
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*(.+?)\*/gs, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s*/gm, "")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** A tool's name, maybe namespaced ("get_debts", "default_api:get_debts"): lower case words joined by underscores. */
const TOOL = "(?:[a-z_]+:)?[a-z][a-z0-9]*(?:_[a-z0-9]+)+";
/** The one-word sources the model cites (the sections its tools return), never prose on their own. */
const SOURCE = "profile|accounts|debts|holdings|goals|portfolio|transactions|insights";
const TOKEN = `(?:${UUID}|${TOOL}|${SOURCE})`;
/**
 * A bracket holding only sources, one or a comma-separated list ("[get_debts]",
 * "[profile, get_financial_path]", "[uuid]"), with the space before it. Not
 * the text of a link ("[accounts](/accounts)"), and not prose ("[note]", "[Two words]").
 */
const ID_CITATION = new RegExp(`[ \\t]*\\[\\s*${TOKEN}(?:\\s*,\\s*${TOKEN})*\\s*\\](?!\\()`, "g");

/**
 * The model cites its sources in brackets after a sentence: the id of a
 * record a tool returned, the tool itself, or the section it read. None of
 * them means anything to a person and the web shows them raw, so the chat
 * drops them. The server prompt now asks it not to. This is the safety net.
 */
export function hideIdCitations(text: string): string {
  return text.replace(ID_CITATION, "");
}

/** A thread's date in the list: Today, Yesterday, Nov 19, or Nov 19, 2025 in another year. */
export function threadDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (day(d) === day(y)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export type LinkTarget = { kind: "app"; path: string } | { kind: "web"; url: string } | { kind: "system"; url: string } | null;

/**
 * Where a link in an answer goes: an app path ("/transactions?categories=…",
 * or the web app's own address) opens in the app, a web page in the browser,
 * mail and phone links in their apps. Anything else is not a link.
 */
export function linkTarget(href: string, webOrigin: string): LinkTarget {
  const h = href.trim();
  if (h.startsWith("/") && !h.startsWith("//")) return { kind: "app", path: h };
  if (webOrigin && (h === webOrigin || h.startsWith(`${webOrigin}/`) || h.startsWith(`${webOrigin}?`))) {
    const rest = h.slice(webOrigin.length);
    return { kind: "app", path: rest.startsWith("/") ? rest : `/${rest}` };
  }
  if (/^https?:\/\//i.test(h)) return { kind: "web", url: h };
  if (/^(mailto|tel):/i.test(h)) return { kind: "system", url: h };
  return null;
}
