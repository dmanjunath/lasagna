import { beforeAll, describe, it, expect } from 'vitest';

// Vitest strips CSS content (even ?raw), so theme.css is read from disk. The
// specifier is built at runtime so the package stays free of node types.
let themeCss = '';
beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (u: URL, enc: string) => string };
  themeCss = fs.readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8');
});

/**
 * Design-system conformance. Each rule here is a pattern the app already chose
 * after a review, written down so it can't drift back one file at a time.
 *
 * Rules with existing offenders are RATCHETS: the allowance is today's count
 * per file. A new offender fails the suite. Fixing one also fails it, until the
 * allowance is lowered here, so the number only ever goes down. Raising an
 * allowance means editing this file, which puts the decision in front of a
 * reviewer.
 */

const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const source = Object.entries(files)
  .map(([path, text]) => ({ path: path.replace(/^\.\.\//, ''), text }))
  .filter((f) => !f.path.includes('__tests__/') && !f.path.endsWith('.test.ts') && !f.path.endsWith('.test.tsx'));

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

// Every file whose count of `re` is not exactly its allowance.
// `fix` says what to use instead, so a failure names the shared component.
function ratchet(re: RegExp, allowed: Record<string, number>, skip: (path: string) => boolean = () => false, fix = '') {
  const problems: string[] = [];
  for (const f of source) {
    if (skip(f.path)) continue;
    const n = count(f.text, re);
    const max = allowed[f.path] ?? 0;
    if (n > max) problems.push(`${f.path}: ${n} (allowed ${max})${fix ? `. ${fix}` : ''}`);
    else if (n < max) problems.push(`${f.path}: ${n}, lower its allowance from ${max} to ${n}`);
  }
  for (const path of Object.keys(allowed)) {
    if (!source.some((f) => f.path === path)) problems.push(`${path}: file is gone, remove its allowance`);
  }
  return problems;
}

describe('design lint', () => {
  /**
   * Some --ui-* tokens are bare channel triples ("5 178 121"), meant for
   * rgb(var(--x) / alpha). Others are whole colors (rgba(...), #hex). Wrapping a
   * whole color in rgb() is invalid CSS, and the property silently drops: a
   * selected row and the create-rule bar both rendered with no tint this way.
   */
  it('never wraps a whole-color token in rgb()', () => {
    expect(themeCss.length).toBeGreaterThan(0);
    const wholeColor = new Set<string>();
    for (const m of themeCss.matchAll(/--(ui-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      if (/^\s*(rgba?\(|#|hsla?\(|var\()/.test(m[2])) wholeColor.add(m[1]);
    }
    const problems: string[] = [];
    for (const f of source) {
      for (const m of f.text.matchAll(/rgb\(var\(--(ui-[a-z0-9-]+)\)/g)) {
        if (wholeColor.has(m[1])) problems.push(`${f.path}: rgb(var(--${m[1]})) — use var(--${m[1]})`);
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * Menus are the shared, styled ones (OptionMenu, AccountPicker,
   * CategoryPicker), never the browser's native list. uikit's Select wraps a
   * native <select>, so it counts too.
   */
  it('does not add native selects', () => {
    expect(ratchet(/<select[\s>]/g, NATIVE_SELECT_ALLOWED, (p) => p === 'components/uikit/Select.tsx', 'Use OptionMenu, AccountPicker or CategoryPicker')).toEqual([]);
  });

  it('does not add uikit <Select> dropdowns', () => {
    expect(ratchet(/<Select[\s>]/g, UIKIT_SELECT_ALLOWED, undefined, 'Use OptionMenu, AccountPicker or CategoryPicker')).toEqual([]);
  });

  /** A money field is typed, not nudged by 1: number inputs drop the stepper arrows. */
  it('hides the stepper on number inputs', () => {
    const problems: string[] = [];
    for (const f of source) {
      if (!f.text.includes('type="number"')) continue;
      // Each number input is checked on its own: the no-stepper class, or a
      // constant holding it, must appear in the few lines around it.
      const consts = [...f.text.matchAll(/const (\w+)\s*=[^;]*inner-spin-button\]:appearance-none/g)].map((m) => m[1]);
      const lines = f.text.split('\n');
      let bad = 0;
      lines.forEach((line, i) => {
        if (!line.includes('type="number"')) return;
        const near = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
        // uikit Input / MoneyInput hide the stepper themselves (fieldBase).
        const before = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
        // Only inputs count: a chart axis takes type="number" too.
        const tag = [...before.matchAll(/<([A-Za-z]+)/g)].pop()?.[1];
        if (tag !== 'input' && tag !== 'Input' && tag !== 'MoneyInput') return;
        const ok = tag !== 'input'
          || near.includes('inner-spin-button]:appearance-none')
          || consts.some((c) => new RegExp(`\\b${c}\\b`).test(near));
        if (!ok) bad++;
      });
      const max = NUMBER_STEPPER_ALLOWED[f.path] ?? 0;
      if (bad > max) problems.push(`${f.path}: ${bad} number input(s) with stepper arrows (allowed ${max})`);
      else if (bad < max) problems.push(`${f.path}: ${bad}, lower its allowance from ${max} to ${bad}`);
    }
    expect(problems).toEqual([]);
  });

  /**
   * Category menus all render CategoryList (search, group bands, manage
   * footer), so the taxonomy's picker groups are read in a few places only.
   */
  it('builds category lists only through CategoryList', () => {
    expect(ratchet(/usePickerGroups\(/g, PICKER_GROUPS_ALLOWED, undefined, 'Use CategoryPicker or CategoryList')).toEqual([]);
  });

  /**
   * The legacy --color-* scale is not dark-aware (.dark remaps only --ui-*), so
   * text-text, bg-surface and border-border render light colors on a dark
   * canvas.
   */
  it('does not add legacy --color-* tokens', () => {
    const legacy = /(?<![\w-])(?:text|bg|border(?:-[trblxy])?|ring|ring-offset|fill|stroke|from|via|to|divide|outline|placeholder|decoration|caret|shadow|accent)-(?:bg|surface|border|text|accent|gold|success|warning|danger)(?:-[a-z]+)?(?:\/\d+|\/\[[^\]]+\])?(?![\w-])|var\(--color-/g;
    expect(ratchet(legacy, LEGACY_COLOR_ALLOWED, undefined, 'Use the --ui-* tokens (content, panel, line, brand, positive, negative, caution)')).toEqual([]);
  });

  /** A link that goes somewhere is TextLink (brand ink, chevron), not text ending in an arrow. */
  it('does not hand-roll arrow links', () => {
    expect(ratchet(/→\s*<\/(?:a|Link|button)>/g, ARROW_LINK_ALLOWED, undefined, 'Use TextLink from components/uikit')).toEqual([]);
  });

  /**
   * No eyebrow text: small uppercase tracked kickers above titles are banned
   * (CLAUDE.md). The uikit primitives own the few sanctioned uses, such as
   * table headers.
   */
  it('does not add uppercase text', () => {
    expect(ratchet(/\buppercase\b/g, UPPERCASE_ALLOWED, (p) => p.startsWith('components/uikit/'), 'No eyebrow text. Use a normal heading or label, or the uikit Table for column headers')).toEqual([]);
  });
});

// ── Allowances (today's counts; lower them as files are fixed) ────────────────

const NATIVE_SELECT_ALLOWED: Record<string, number> = {
  // Mentioned in a comment, not rendered.
  'lib/account-types.ts': 1,
};

const UIKIT_SELECT_ALLOWED: Record<string, number> = {
  // The styleguide documents the primitive itself.
  'pages/_styleguide.tsx': 2,
};

const NUMBER_STEPPER_ALLOWED: Record<string, number> = {};

const PICKER_GROUPS_ALLOWED: Record<string, number> = {
  // Sanctioned: the hook itself, the one list that renders it, and the chips
  // that name a selection.
  'lib/taxonomy.tsx': 1,
  'components/common/CategoryList.tsx': 1,
  'components/common/CategoryMultiSelect.tsx': 1,
};

const LEGACY_COLOR_ALLOWED: Record<string, number> = {
  'components/chat/floating-chat-pill.tsx': 4,
  'components/chat/starter-prompts.tsx': 14,
  'components/chat/tool-status.tsx': 1,
  'components/common/DemoBanner.tsx': 1,
  'components/ui/button.tsx': 16,
  'components/ui/editable-title.tsx': 1,
};

const ARROW_LINK_ALLOWED: Record<string, number> = {
  'components/common/DemoBanner.tsx': 1,
  'pages/Login.tsx': 1,
  'pages/admin-user.tsx': 1,
};

const UPPERCASE_ALLOWED: Record<string, number> = {
  // Group band headers in the shared menus.
  'components/common/AccountLinkPicker.tsx': 1,
  'components/common/AccountPicker.tsx': 1,
  'components/common/CategoryList.tsx': 1,
  'components/common/OptionMenu.tsx': 1,
  // The styleguide documents the type scale.
  'pages/_styleguide.tsx': 2,
  // Today's counts.
  'components/admin/user-account-card.tsx': 4,
  'components/ds/institutions.ts': 1,
  'components/plan-response/cards/comparison-card.tsx': 1,
  'components/plan-response/charts/portfolio-histogram.tsx': 5,
  'components/plan-response/charts/quantile-chart.tsx': 5,
  'components/plan-response/charts/scenario-explorer.tsx': 1,
  'components/plan-response/charts/timeline-scrubber.tsx': 1,
  'components/plan-response/charts/wealth-projection.tsx': 2,
  'components/plan-response/charts/withdrawal-timeline.tsx': 4,
  'components/plan-response/metrics-bar.tsx': 1,
  'components/settings/display-font-picker.tsx': 1,
  'components/transactions/TransactionList.tsx': 1,
  'components/ui-renderer/blocks/account-summary.tsx': 2,
  'components/ui-renderer/blocks/stat-block.tsx': 1,
  'components/ui-renderer/blocks/table-block.tsx': 1,
  'pages/Settings.tsx': 3,
  'pages/admin-spend.tsx': 2,
  'pages/admin-user.tsx': 1,
  'pages/admin.tsx': 3,
  'pages/financial-plans/[id].tsx': 19,
  'pages/goals.tsx': 3,
  'pages/plans/new.tsx': 1,
  'pages/portfolio-composition.tsx': 5,
  'pages/probability-of-success.tsx': 6,
  'pages/retirement-v2.tsx': 1,
  'pages/savings-goal.tsx': 3,
  'pages/simple-home.tsx': 6,
  'pages/spending.tsx': 3,
  'pages/tax-strategy.tsx': 1,
  'pages/transactions.tsx': 1,
};
