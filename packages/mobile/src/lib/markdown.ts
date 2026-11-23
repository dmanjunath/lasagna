// The Markdown an answer is written in, parsed into blocks the chat draws
// natively. It covers what the web renders through react-markdown with
// remark-gfm (message-bubble.tsx): headings, paragraphs, bold, italic, inline
// and fenced code, links, nested bullet and numbered lists, block quotes,
// rules and GFM tables. HTML is shown as text.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "break" };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "quote"; children: Block[] }
  | { type: "code"; text: string }
  | { type: "rule" }
  | { type: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] };

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => line.trim() === "";

/** Splits a table row into its cells, without the outer pipes. */
function cells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  // An escaped pipe ("\\|") is part of the cell.
  return s.replace(/\\\|/g, "\u0000").split("|").map((c) => c.trim().replace(/\u0000/g, "|"));
}

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-");
}

/** A line that starts a block of its own, so it ends a paragraph above it. */
function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return FENCE.test(l) || HEADING.test(l) || RULE.test(l) || QUOTE.test(l) || (ITEM.test(l) && indentOf(l) <= 3) || isTableStart(lines, i);
}

export function parseMarkdown(src: string): Block[] {
  return parseBlocks(src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      i++;
      continue;
    }
    // A rule before a list: "* * *" and "---" are rules, not items.
    if (RULE.test(line)) {
      out.push({ type: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i]) && (QUOTE.test(lines[i]) || body.length > 0)) {
        if (!QUOTE.test(lines[i]) && startsBlock(lines, i)) break;
        body.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      out.push({ type: "quote", children: parseBlocks(body) });
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = cells(line);
      const align: Align[] = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
        const r = cells(lines[i++]);
        rows.push(head.map((_, c) => parseInline(r[c] ?? "")));
      }
      out.push({ type: "table", align: head.map((_, c) => align[c] ?? null), head: head.map(parseInline), rows });
      continue;
    }
    if (ITEM.test(line) && indentOf(line) <= 3) {
      i = parseList(lines, i, out);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !startsBlock(lines, i))) para.push(lines[i++]);
    out.push({ type: "paragraph", children: parseInline(para.map((l) => l.trim()).join("\n")) });
  }
  return out;
}

/** A list from line `i`: its items, each parsed as blocks, nested lists included. Returns the line after it. */
function parseList(lines: string[], i: number, out: Block[]): number {
  const first = ITEM.exec(lines[i])!;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items: string[][] = [];
  let width = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = ITEM.exec(line);
    if (m && m[1].length === base && /\d/.test(m[2]) === ordered) {
      // A new item at this list's depth.
      width = base + m[2].length + 1;
      items.push([m[3]]);
      i++;
      continue;
    }
    if (blank(line)) {
      // A blank line keeps the list going only if indented content or another item follows.
      let j = i + 1;
      while (j < lines.length && blank(lines[j])) j++;
      const next = lines[j];
      const nm = next !== undefined ? ITEM.exec(next) : null;
      const continues = next !== undefined && (indentOf(next) > base || (nm && nm[1].length === base && /\d/.test(nm[2]) === ordered));
      if (!continues) break;
      items[items.length - 1].push("");
      i++;
      continue;
    }
    if (indentOf(line) > base) {
      // Content of the current item (a nested list, a continued line), out by the item's width.
      items[items.length - 1].push(line.slice(Math.min(indentOf(line), width)));
      i++;
      continue;
    }
    // An unindented line right after an item's text continues it (a lazy line), unless it starts a block.
    const prev = items[items.length - 1];
    if (prev[prev.length - 1] !== "" && !startsBlock(lines, i)) {
      prev.push(line.trim());
      i++;
      continue;
    }
    break;
  }
  out.push({ type: "list", ordered, start, items: items.map(parseBlocks) });
  return i;
}

// ── Inline ──────────────────────────────────────────────────────────────────

/** `notInWord`: the rule may not start inside a word (snake_case is not emphasis). */
type Rule = { re: RegExp; make: (m: RegExpExecArray) => Inline; notInWord?: boolean };

const RULES: Rule[] = [
  { re: /\\([\\`*_[\]()#+\-.!|>~])/y, make: (m) => ({ type: "text", text: m[1] }) },
  { re: /`([^`]+)`/y, make: (m) => ({ type: "code", text: m[1] }) },
  { re: /\[((?:[^\][]|\[[^\]]*\])+)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/y, make: (m) => ({ type: "link", href: m[2], children: parseInline(m[1]) }) },
  { re: /<(https?:\/\/[^>\s]+)>/y, make: (m) => ({ type: "link", href: m[1], children: [{ type: "text", text: m[1] }] }) },
  { re: /\*\*(?!\s)([\s\S]+?)\*\*/y, make: (m) => ({ type: "strong", children: parseInline(m[1]) }) },
  { re: /__(?!\s)([\s\S]+?)__(?!\w)/y, make: (m) => ({ type: "strong", children: parseInline(m[1]) }), notInWord: true },
  { re: /\*(?![\s*])([^*]*?[^\s*])\*/y, make: (m) => ({ type: "em", children: parseInline(m[1]) }) },
  { re: /_(?![\s_])([^_]*?[^\s_])_(?!\w)/y, make: (m) => ({ type: "em", children: parseInline(m[1]) }), notInWord: true },
  { re: /https?:\/\/[^\s<>)\]]*[^\s<>)\].,;:!?'"]/y, make: (m) => ({ type: "link", href: m[0], children: [{ type: "text", text: m[0] }] }) },
  // Two trailing spaces, or a backslash, before a newline: a hard break. Otherwise a newline is a space, as on the web.
  { re: /(?: {2,}|\\)\n/y, make: () => ({ type: "break" }) },
];

/** The characters any rule can start on; everything between them is plain text. */
const SPECIAL = /[\\`[<*_h \n]/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text: text.replace(/\n/g, " ") });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    SPECIAL.lastIndex = i;
    const s = SPECIAL.exec(src);
    if (!s) {
      text += src.slice(i);
      break;
    }
    text += src.slice(i, s.index);
    i = s.index;
    let matched = false;
    for (const rule of RULES) {
      if (rule.notInWord && i > 0 && /\w/.test(src[i - 1])) continue;
      rule.re.lastIndex = i;
      const m = rule.re.exec(src);
      if (m) {
        const node = rule.make(m);
        if (node.type === "text") text += node.text;
        else {
          flush();
          out.push(node);
        }
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) text += src[i++];
  }
  flush();
  return out;
}

/** An inline run's plain text (a link's label for VoiceOver, a copy). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : n.type === "break" ? "\n" : inlineText(n.children))).join("");
}
