#!/usr/bin/env node
/**
 * Native-feel audit. Static checks over packages/web/src, run until it exits 0.
 * Each rule names the defect class it guards against, so a new surface that
 * reintroduces one fails here instead of on a device.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'packages/web/src';
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) { if (e !== '__tests__') walk(p); }
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})(ROOT);
const read = (f) => readFileSync(f, 'utf8');
// Prose about a defect is not the defect. Blank out comments (preserving line
// count so reported line numbers still point at the real source).
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
const rel = (f) => relative(ROOT, f);

const findings = [];
const fail = (rule, file, msg) => findings.push({ rule, file: rel(file), msg });

// Surfaces that cover the screen but have nothing scrollable behind them, or
// are not dismissible overlays at all.
const LOCK_EXEMPT = new Set([
  'components/uikit/Toast.tsx',            // transient, does not block the page
  'components/common/BootCover.tsx',       // boot paint, no interaction
  'components/common/BootBoundary.tsx',    // error boundary, full page
  'components/native/BiometricLock.tsx',   // covers everything, gates all input
  'components/ui/confirm-dialog.tsx',      // dead code, nothing imports it
  'components/simulation/year-detail.tsx', // hover tooltip, not a dismissible overlay
]);

for (const f of files) {
  const s = stripComments(read(f));
  const r = rel(f);

  // 1. Overlays must lock document scroll, or the page slides underneath.
  const isOverlay = /createPortal|role="dialog"|aria-modal|role="menu"|role="listbox"/.test(s);
  if (isOverlay && !LOCK_EXEMPT.has(r) && !/useBodyScrollLock/.test(s)) {
    fail('overlay-scroll-lock', f, 'overlay/popover does not call useBodyScrollLock');
  }

  // 2. Browser dialogs are not iOS dialogs.
  for (const m of s.matchAll(/(?<![.\w])(window\.(confirm|alert|prompt)|alert)\s*\(/g)) {
    if (/^\s*[*/]/.test(s.slice(s.lastIndexOf('\n', m.index) + 1, m.index))) continue;
    fail('no-browser-dialog', f, `${m[1]}() renders Safari chrome, use ds/Confirm`);
  }

  // 3. A <select> is fine, and on iOS it is what opens the system picker. What
  // must not ship is the browser's default chrome, a legacy non-dark-aware
  // palette, or appearance-none with no chevron left to show it is a menu.
  if (r !== 'components/uikit/Select.tsx') {
    for (const m of s.matchAll(/<select\b[\s\S]*?<\/select>/g)) {
      const block = m[0];
      const line = s.slice(0, m.index).split('\n').length;
      // Not indexOf('>'): an onChange arrow function contains one. Attributes
      // are everything before the first <option.
      const optionAt = block.indexOf('<option');
      const opener = optionAt > 0 ? block.slice(0, optionAt) : block;
      // The chevron is a sibling, so look just past the closing tag too.
      const withSiblings = s.slice(m.index, m.index + block.length + 260);
      // An opacity-0 select stretched over a custom trigger is deliberate, and
      // is the good iOS pattern: the visuals are ours, the tap opens the system
      // picker. Nothing to restyle.
      if (/opacity-0/.test(opener)) continue;
      if (/\b(bg-surface|border-border|text-text|bg-background)\b/.test(opener)) {
        fail('select-chrome', f, `select at line ${line} uses the legacy --color-* palette, which is not dark-aware`);
      } else if (!/appearance-none/.test(opener)) {
        fail('select-chrome', f, `select at line ${line} keeps the browser's default chrome`);
      } else if (!/Chevron|chevron/.test(withSiblings)) {
        fail('select-chrome', f, `select at line ${line} strips the native arrow but adds no chevron, so it reads as a text field`);
      }
    }
  }

  // 3b. The mobile tab bar is fixed at bottom-0 and paints last, so anything
  // else pinned to the bottom edge ends up underneath it.
  const TAB_BAR_EXEMPT = new Set([
    'components/layout/mobile-tab-bar.tsx',   // is the tab bar
    'components/uikit/Toast.tsx',             // already clears it by 80px
  ]);
  if (!TAB_BAR_EXEMPT.has(r)) {
    for (const m of s.matchAll(/className=[{"`][^"`]*?\bfixed\b[^"`]*?\bbottom-0\b[^"`]*/g)) {
      const cls = m[0];
      if (/md:hidden|sm:hidden/.test(cls)) continue;          // desktop-only surface
      if (/(sm|md):bottom-0/.test(cls)) continue;             // already lifted on phones
      const line = s.slice(0, m.index).split('\n').length;
      fail('tab-bar-overlap', f, `fixed bottom-0 at line ${line} sits under the mobile tab bar`);
    }
  }

  // 4. Viewport-centred auth layouts jump when the keyboard shrinks the frame.
  if (/<[Ii]nput\b/.test(s)) {
    // A breakpoint-prefixed sm:items-center is fine: the keyboard only shrinks
    // the frame on phones, and those are below the sm breakpoint.
    const line = s.split('\n').findIndex(
      (l) => /min-h-dvh/.test(l) && /(^|\s)items-center/.test(l),
    );
    if (line >= 0) fail('no-viewport-centred-form', f, `min-h-dvh + unprefixed items-center with inputs (line ${line + 1}) jumps when the keyboard shrinks the frame`);
  }

  // 5. Text entry should tell iOS which keyboard and which return key to show.
  for (const m of s.matchAll(/<[Ii]nput\b[^>]*?\/?>/gs)) {
    const tag = m[0];
    if (/type=[{"](checkbox|radio|hidden|range|file|color)/.test(tag)) continue;
    const typed = /type="(email|tel|url|search)"/.exec(tag);
    if (!typed) continue;
    if (!/enterKeyHint=/.test(tag)) {
      const line = s.slice(0, m.index).split('\n').length;
      fail('keyboard-hints', f, `type="${typed[1]}" input without enterKeyHint (line ${line})`);
    }
  }
}

const byRule = {};
for (const f of findings) (byRule[f.rule] ||= []).push(f);
const rules = Object.keys(byRule).sort();
if (!rules.length) { console.log('native-feel audit: PASS (0 findings)'); process.exit(0); }
console.log(`native-feel audit: FAIL (${findings.length} findings)\n`);
for (const r of rules) {
  console.log(`  ${r}  (${byRule[r].length})`);
  for (const f of byRule[r]) console.log(`     ${f.file}: ${f.msg}`);
  console.log('');
}
process.exit(1);
