// Titles for the chat history list.
//
// A title is either one the model wrote for a typed question, one the app set
// when it opened the thread from a step or an insight, or, when neither is
// usable, the user's first message cut to a readable length. The model's text
// is checked before it is stored, because a reasoning model given a small
// output budget has handed back its own thinking ("The user wants a short
// title ...") or a word cut in half ("Acceler") as the title.

// The reply the chat route used to store when a turn produced no text. Rows that
// hold only this are failed generations, not conversations.
export const LEGACY_FAILED_REPLY = "I wasn't able to generate a response. Please try again.";

const MAX_TITLE_CHARS = 60;

const PLACEHOLDER_TITLES = new Set(["conversation", "new chat", "new conversation", "untitled", "chat", "title"]);

// Text that is the model talking about the task rather than a title for it.
const INSTRUCTION_PATTERNS = [
  /\bthe user\b/i,
  /\bshort title\b/i,
  /\b\d+\s*-\s*\d+\s+words\b/i,
  /\btitle for\b/i,
  /\bno quotes\b/i,
  /\bjust the title\b/i,
  /\bfinancial conversation\b/i,
  /^(okay|ok|sure|here|let me|let's|i |i'm|i'll|we |user\b|title\b|generate\b)/i,
];

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/** True when `title` reads as a title a person would recognise. */
export function isUsableTitle(title: string | null | undefined): title is string {
  if (!title) return false;
  const t = collapse(title);
  if (t.length < 3 || t.length > 80) return false;
  if (PLACEHOLDER_TITLES.has(t.toLowerCase())) return false;
  const words = t.split(" ").length;
  // One word is how a truncated reply looks ("Calculating", "Acceler").
  if (words < 2 || words > 12) return false;
  if ((t.match(/\(/g)?.length ?? 0) !== (t.match(/\)/g)?.length ?? 0)) return false;
  return !INSTRUCTION_PATTERNS.some((re) => re.test(t));
}

/**
 * The title for a thread the app opened from a step or an insight, read back
 * from the prompt it sent. Threads opened before launchers set their own title
 * carry only the prompt, so this recovers the subject for them.
 */
export function launcherSubject(message: string): string | null {
  const step = message.match(/^Walk me through step \d+ of my financial path, "(.+?)"/);
  if (step) return collapse(step[1]);
  const insight = message.match(/^Walk me through this insight:\s*\n+\s*Title:\s*(.+)$/m);
  if (insight) return collapse(insight[1]);
  return null;
}

function truncate(s: string): string {
  if (s.length <= MAX_TITLE_CHARS) return s;
  const cut = s.slice(0, MAX_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}

/** A title built from the user's first message, used when no better one exists. */
export function fallbackTitle(firstMessage: string | null | undefined): string | null {
  if (!firstMessage?.trim()) return null;
  const subject = launcherSubject(firstMessage);
  if (subject) return truncate(subject);
  // The first line: a prompt that opens "Here is my plan:" and then lists
  // figures is named by its opening line, not by the figures.
  const firstLine = firstMessage.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const text = collapse(stripMarkdown(firstLine)).replace(/:$/, "");
  if (!text) return null;
  // The first sentence when it is short enough to stand alone.
  const sentence = text.match(/^.+?[.?!](?=\s|$)/)?.[0];
  return truncate(sentence && sentence.length <= MAX_TITLE_CHARS ? sentence : text);
}

/**
 * Clean the model's reply to the title request. Returns null when the reply was
 * cut off or is not a usable title, so the caller falls back.
 */
export function cleanGeneratedTitle(text: string, finishReason?: string): string | null {
  if (finishReason && finishReason !== "stop") return null;
  const withoutThinking = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  const line = withoutThinking.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const t = collapse(
    stripMarkdown(line)
      .replace(/^title:\s*/i, "")
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .replace(/[.!?:;,]+$/, ""),
  );
  return isUsableTitle(t) ? t : null;
}

/** The title the history list shows for a stored thread. */
export function displayTitle(title: string | null, firstMessage: string | null): string | null {
  return isUsableTitle(title) ? collapse(title) : fallbackTitle(firstMessage);
}
