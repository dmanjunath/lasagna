import { inlineText, parseInline, parseMarkdown, type Block } from "../markdown";

test("headings, paragraphs and a rule", () => {
  const b = parseMarkdown("## Where you stand\n\nYou spent **$2,400** last month.\nThat is less.\n\n---\n\n### Next");
  expect(b.map((x) => x.type)).toEqual(["heading", "paragraph", "rule", "heading"]);
  expect(b[0]).toMatchObject({ level: 2 });
  // A soft line break is a space, as react-markdown renders it.
  expect(inlineText((b[1] as Extract<Block, { type: "paragraph" }>).children)).toBe("You spent $2,400 last month. That is less.");
});

test("bold, italic, code and links inline", () => {
  expect(parseInline("a **bold _and em_** b")).toEqual([
    { type: "text", text: "a " },
    { type: "strong", children: [{ type: "text", text: "bold " }, { type: "em", children: [{ type: "text", text: "and em" }] }] },
    { type: "text", text: " b" },
  ]);
  expect(parseInline("see [your spending](/spending?period=2026-10) now")[1]).toEqual({
    type: "link",
    href: "/spending?period=2026-10",
    children: [{ type: "text", text: "your spending" }],
  });
  expect(parseInline("`code` and *it*")).toEqual([
    { type: "code", text: "code" },
    { type: "text", text: " and " },
    { type: "em", children: [{ type: "text", text: "it" }] },
  ]);
});

test("snake_case, a lone asterisk and a multiplication are text", () => {
  expect(inlineText(parseInline("get_net_worth costs 2 * 3"))).toBe("get_net_worth costs 2 * 3");
  expect(parseInline("get_net_worth")).toEqual([{ type: "text", text: "get_net_worth" }]);
});

test("a bare web address is a link, without its trailing period", () => {
  const n = parseInline("Rates are at https://example.com/rates.");
  expect(n[1]).toEqual({ type: "link", href: "https://example.com/rates", children: [{ type: "text", text: "https://example.com/rates" }] });
  expect(n[2]).toEqual({ type: "text", text: "." });
});

test("bullets and numbers, with nested lists by two or four spaces", () => {
  const [list] = parseMarkdown("- Cash\n  - Checking\n  - Savings\n- Debt\n\n1. First\n2. Second\n    - detail");
  expect(list).toMatchObject({ type: "list", ordered: false });
  const items = (list as Extract<Block, { type: "list" }>).items;
  expect(items).toHaveLength(2);
  expect(items[0][1]).toMatchObject({ type: "list", ordered: false });
  expect((items[0][1] as Extract<Block, { type: "list" }>).items).toHaveLength(2);
  const ol = parseMarkdown("1. First\n2. Second\n    - detail")[0] as Extract<Block, { type: "list" }>;
  expect(ol).toMatchObject({ ordered: true, start: 1 });
  expect(ol.items[1][1]).toMatchObject({ type: "list" });
});

test("a list ends at a paragraph after a blank line, and keeps a loose item", () => {
  const b = parseMarkdown("- one\n\n- two\n\nAfter the list.");
  expect(b.map((x) => x.type)).toEqual(["list", "paragraph"]);
  expect((b[0] as Extract<Block, { type: "list" }>).items).toHaveLength(2);
});

test("an ordered list keeps its start number", () => {
  expect(parseMarkdown("3. Third\n4. Fourth")[0]).toMatchObject({ ordered: true, start: 3 });
});

test("a GFM table with alignment, short rows padded", () => {
  const [t] = parseMarkdown("| Account | Balance |\n|:--|--:|\n| Checking | $1,200 |\n| Savings |");
  expect(t).toMatchObject({ type: "table", align: ["left", "right"] });
  const table = t as Extract<Block, { type: "table" }>;
  expect(table.head.map(inlineText)).toEqual(["Account", "Balance"]);
  expect(table.rows.map((r) => r.map(inlineText))).toEqual([
    ["Checking", "$1,200"],
    ["Savings", ""],
  ]);
});

test("a paragraph runs into a table without a blank line", () => {
  expect(parseMarkdown("Here it is:\n| A | B |\n|---|---|\n| 1 | 2 |").map((x) => x.type)).toEqual(["paragraph", "table"]);
});

test("block quotes and fenced code", () => {
  const b = parseMarkdown("> Pay **yourself** first.\n\n```\nnot *markdown*\n```");
  expect(b[0]).toMatchObject({ type: "quote" });
  expect(b[1]).toEqual({ type: "code", text: "not *markdown*" });
});

test("an empty answer has no blocks", () => {
  expect(parseMarkdown("")).toEqual([]);
});
