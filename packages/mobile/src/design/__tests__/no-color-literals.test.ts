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

// Screens and components draw with theme tokens only (useTheme), so a theme
// swap restyles everything and Noodle can never pick up a stray cool gray.
// A hex or rgb() literal outside packages/design fails here, naming the file.
// The allowlist holds the few literals that are not a theme's to choose.

const root = join(__dirname, "../../..");
const DIRS = ["src", "app"];

const ALLOW: Record<string, string[]> = {
  // The home net worth card's credit-card segment, a literal on the web too.
  "src/design/resolve.ts": ["#F97316"],
  // UIRefreshControl's spinner, drawn as good as invisible (see the file).
  "src/ui/PullRefresh.tsx": ["rgba(0, 0, 0, 0.004)"],
};

const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(\s*\d[^)]*\)|hsla?\(\s*\d[^)]*\)/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

test("no color literals outside the theme files", () => {
  const found: string[] = [];
  for (const dir of DIRS) {
    for (const file of files(join(root, dir))) {
      const rel = relative(root, file);
      const allowed = ALLOW[rel] ?? [];
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.match(LITERAL) ?? []) if (!allowed.includes(m)) found.push(`${rel}:${i + 1} ${m}`);
        });
    }
  }
  expect(found).toEqual([]);
});
