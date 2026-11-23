// This package has no Node types: just the calls this test makes.
declare const __dirname: string;
declare function require(id: "fs"): {
  readdirSync(p: string): string[];
  readFileSync(p: string, encoding: "utf8"): string;
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(id: "path"): { join(...p: string[]): string; relative(from: string, to: string): string };
const { readdirSync, readFileSync, statSync } = require("fs");
const { join, relative } = require("path");

// One surface plus one hero tint (owner decision 2026-11-23): every card is
// the plain surface, and only a screen's hero, its top summary card, wears its
// role's tint. A role tint used as a fill outside the hero treatment fails
// here, and so does a new hero: add it to HEROES on purpose, one per screen.

const root = join(__dirname, "../../..");
const DIRS = ["src", "app"];

/** The files that draw a hero, and the role each draws. Alternatives (Debt's debt-free state) share a screen's one slot. */
const HEROES: Record<string, string[]> = {
  "src/components/accounts/TrendCard.tsx": ["{role}"], // Accounts net worth, an account's balance
  // A deliberate exception to one tint per screen: here color carries direction (in/out), so money in
  // keeps the income tint and money out the spend tint (owner, 2026-11-23: color used thoughtfully).
  "src/components/transactions/SummaryStrip.tsx": ['{tone === "pos" ? "income" : "spend"}'],
  "src/components/actions/ActionGroup.tsx": ["{hero}", '{hero ? "action" : undefined}', '{hero ? "action" : undefined}'], // the Actions screen's first band
  "src/screens/ActionsScreen.tsx": ["(bare)", "{i === 0}"], // the first band's skeleton, and which band is the hero
  "src/screens/DebtScreen.tsx": ["income", "spend"], // debt-free, or the total
  "src/screens/GoalDetailScreen.tsx": ["goal"],
  "src/screens/GoalsScreen.tsx": ["goal"],
  "src/screens/JourneyScreen.tsx": ["income"],
  "src/screens/PortfolioScreen.tsx": ["wealth", "wealth"], // by account, or the holdings value
  "src/screens/SpendingScreen.tsx": ["spend"],
  "src/screens/TaxScreen.tsx": ["wealth"],
};

/** The only places a role tint's fill paints a background, each for a reason. */
const TINT_FILLS = new Set([
  "src/screens/AccountsScreen.tsx", // a broken bank connection's card wears the yellow attention fill (meaningful color)
  "src/ui/Card.tsx", // the hero treatment itself
  "src/components/home/GreetingCard.tsx", // Home's hero, the speech bubble
  "src/ui/Chip.tsx", // a chosen pill, not a card
  "src/components/profile/SettingsParts.tsx", // a settings row's icon tile, not a card
  "src/design/tint.ts", // the role-color test
]);

/**
 * Color that tells the user something (owner, 2026-11-23: "color used
 * thoughtfully, not just by rule"). Each screen or component that paints a
 * verdict is listed with what the color means, and says "meaningful color"
 * where it does it. One fixed meaning per color: basil good, yellow needs
 * attention, sauce bad. Net worth, balances and investment tiles stay neutral.
 */
const MEANINGFUL: Record<string, string> = {
  "src/components/goals/GoalParts.tsx": "a goal's progress: on track basil, slipping yellow, off track sauce",
  "src/components/spending/BreakdownCard.tsx": "a category running ahead of its usual pace: sauce (under pace says nothing)",
  "src/components/TxnRow.tsx": "pending muted, excluded faded, money back basil",
  "src/screens/AccountsScreen.tsx": "a broken bank connection needs the user: yellow",
  "src/screens/DebtScreen.tsx": "the debt to pay next: basil current-item marker",
  "src/screens/JourneyScreen.tsx": "retirement readiness: on track basil, needs attention yellow, at risk sauce",
  "src/screens/PortfolioScreen.tsx": "a holding's own gain basil, loss sauce, only on real cost basis",
  "src/screens/TaxDocumentSheet.tsx": "a 1040's stated refund basil, amount owed sauce",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

const all = DIRS.flatMap((d) => files(join(root, d))).map((p) => ({ rel: relative(root, p), src: readFileSync(p, "utf8") }));

test("each screen has one hero, in its role", () => {
  const found: Record<string, string[]> = {};
  for (const { rel, src } of all) {
    const props = [...src.matchAll(/<[A-Z][A-Za-z]*\b[^<>]*?\shero(?:="([a-z]+)"|=(\{[^}]*\})|(?=[\s/>]))/g)].map((m) => m[1] ?? m[2] ?? "(bare)");
    if (props.length) found[rel] = props;
  }
  expect(found).toEqual(HEROES);
});

test("a role tint fills a background only in the hero treatment", () => {
  const FILL = /tint(?:\.[a-z]+|\[[^\]]+\])\.fill|\{\s*fill\b[^}]*\}\s*=\s*[^;\n]*\.tint\b|color\.highlight\b|\bt\.highlight\b/;
  const strays = all.filter(({ rel, src }) => FILL.test(src) && !TINT_FILLS.has(rel)).map(({ rel }) => rel);
  expect(strays).toEqual([]);
});

test("meaningful color is recorded where it is painted, with what it means", () => {
  const painted = all
    .filter(({ rel }) => !rel.startsWith("src/lib/") && !rel.startsWith("src/design/"))
    .filter(({ src }) => /meaningful color/i.test(src) || /from "@\/design\/meaning"/.test(src))
    .map(({ rel }) => rel)
    .sort();
  expect(painted).toEqual(Object.keys(MEANINGFUL).sort());
  for (const rel of Object.keys(MEANINGFUL)) {
    expect(all.find((f) => f.rel === rel)?.src).toMatch(/meaningful color/i);
  }
});
