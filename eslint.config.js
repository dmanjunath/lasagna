import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

const DATE_FORMAT_MESSAGE =
  "A stored date (a transaction date, a deadline, a statement or maturity date, a month bucket) is a calendar day held as midnight UTC: read in the host's zone it prints the day before, west of UTC. Use formatStoredDay / formatStoredMonth from lib/utils. For a real moment (createdAt, lastSyncedAt, an activity event) use formatInstant / exactSyncTime, which render in the viewer's zone on purpose.";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".worktrees/**",
      ".superpowers/**",
      "scripts/**",
      "e2e/**",
      "take-screenshots.mjs",
      "packages/landing/src/env.d.ts",
      // Capacitor native projects — bundled web output + native scaffolding,
      // not source we author or lint.
      "packages/web/ios/**",
      "packages/web/android/**",
      // Throwaway screenshot/debug scripts (gitignored).
      "**/_shots*/**",
      "mockups/**",
      "test-*.mjs",
    ],
  },
  // Service worker — runs in the ServiceWorkerGlobalScope, so declare its
  // globals rather than trip no-undef.
  {
    files: ["packages/web/public/sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        clients: "readonly",
        fetch: "readonly",
        console: "readonly",
        skipWaiting: "readonly",
        addEventListener: "readonly",
        registration: "readonly",
      },
    },
  },
  // Repo tooling runs under Node, so declare its globals rather than ignore the
  // files: the audit script should stay linted like everything else.
  {
    files: ["tools/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
  // exhaustive-deps is intentionally off (below), but disable directives for it
  // remain across the codebase — don't flag those as unused.
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-undef": "off",
      // Empty catch is an intentional fire-and-forget pattern here.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["packages/web/**/*.tsx"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/static-components": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/exhaustive-deps": "off",
      // Newer react-hooks v6 rule; flags intentional Date.now()-in-render in a
      // couple of analytics views. Off, consistent with the rules above.
      "react-hooks/purity": "off",
    },
  },
  // A stored date read in the host's zone prints the day before, west of UTC —
  // so every date formatter in the web app goes through one of the two named
  // helpers, which say out loud whether the value is a calendar day or a
  // moment. The opt-out is the differently-named helper, not an allowlist.
  // These selectors don't touch the money `toLocaleString` calls: those pass
  // `style`/`currency`/`*FractionDigits`, never a date component.
  {
    files: ["packages/web/src/**/*.ts", "packages/web/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^toLocale(Date|Time)String$/]",
          message: DATE_FORMAT_MESSAGE,
        },
        {
          selector:
            'MemberExpression[object.type="NewExpression"][object.callee.name="Date"][property.name="toLocaleString"]',
          message: DATE_FORMAT_MESSAGE,
        },
        {
          selector:
            'CallExpression[callee.property.name="toLocaleString"] > ObjectExpression:has(Property[key.name=/^(year|month|day|weekday|hour|minute|second|dateStyle|timeStyle)$/])',
          message: DATE_FORMAT_MESSAGE,
        },
        {
          selector: 'MemberExpression[object.name="Intl"][property.name="DateTimeFormat"]',
          message: DATE_FORMAT_MESSAGE,
        },
      ],
    },
  },
  // The helpers themselves are the one place allowed to reach for Intl.
  {
    files: ["packages/web/src/lib/utils.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
];
