import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeId =
  | 'minty'
  | 'rocket'
  | 'cobalt'
  | 'rose'
  | 'coral'
  | 'honey'
  | 'marina'
  | 'fireside'
  | 'graphite'
  | 'hot-topic'
  | 'sapphire'
  | 'amethyst'
  | 'sunshine'
  | 'aqua'
  | 'custom';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  description: string;
  /** Tiny swatch trio shown in the picker. */
  swatches: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  // Row 1
  { id: 'minty',     label: 'Minty',         description: 'Fresh emerald primary on white.',                swatches: ['#10B981', '#3B82F6', '#0F172A'] },
  { id: 'rocket',    label: 'Rocket',        description: 'Bright and punchy. Violet with cyan-green.',     swatches: ['#7C3AED', '#00C896', '#0EA5E9'] },
  { id: 'cobalt',    label: 'Cobalt',        description: 'Confident deep blue. Brex-leaning.',             swatches: ['#2563EB', '#0EA5E9', '#F59E0B'] },
  { id: 'rose',      label: 'Rose Quartz',   description: 'Warm rose pink primary on white.',               swatches: ['#EC4899', '#F472B6', '#1F2937'] },
  { id: 'coral',     label: 'Tropical Heat', description: 'Coral orange — warm and energetic.',             swatches: ['#F97316', '#FB923C', '#1F2937'] },
  // Row 2
  { id: 'honey',     label: 'Honey Opal',    description: 'Honey amber primary on cream-white.',            swatches: ['#D97706', '#F59E0B', '#1F2937'] },
  { id: 'marina',    label: 'Marina',        description: 'Deep marine teal — cool and clean.',             swatches: ['#0D9488', '#06B6D4', '#0F172A'] },
  { id: 'fireside',  label: 'Fireside',      description: 'Fire red — confident and bold.',                 swatches: ['#DC2626', '#F87171', '#1F2937'] },
  { id: 'graphite',  label: 'Graphite',      description: 'Minimal slate ink — Linear-leaning.',            swatches: ['#374151', '#6B7280', '#0F172A'] },
  { id: 'hot-topic', label: 'Hot Topic',     description: 'Hot magenta-pink — vibrant and bold.',           swatches: ['#F54772', '#FB7299', '#1F2937'] },
  // Row 3
  { id: 'sapphire',  label: 'Sapphire',      description: 'Deep sapphire navy — rich and premium.',         swatches: ['#1E3A8A', '#3B82F6', '#0F172A'] },
  { id: 'amethyst',  label: 'Amethyst',      description: 'Saturated amethyst purple — jewel-tone.',        swatches: ['#9333EA', '#A855F7', '#0F172A'] },
  { id: 'sunshine',  label: 'Sunshine',      description: 'Bright sunshine yellow — cheerful.',             swatches: ['#EAB308', '#FACC15', '#1F2937'] },
  { id: 'aqua',      label: 'Aqua',          description: 'Bright cyan aqua — fresh and breezy.',           swatches: ['#06B6D4', '#22D3EE', '#0F172A'] },
  { id: 'custom',    label: 'Custom',        description: 'Pick any accent — Lasagna derives the rest.',    swatches: ['#EC4899', '#EC4899', '#EC4899'] },
];

const STORAGE_KEY = 'lasagna-theme';
const CUSTOM_ACCENT_KEY = 'lasagna-custom-accent';
const DEFAULT_THEME: ThemeId = 'hot-topic';
const DEFAULT_CUSTOM_ACCENT = '#F54772';

// ─── Color math ───────────────────────────────────────────────────────────────
// Every derived accent token (deep variant, glow, border, shadow) is computed
// from a single base hex via these helpers. That's the contract behind the
// "Custom" theme: one input, formulas do the rest.

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function isValidHex(s: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(s.trim());
}

export function normalizeHex(s: string): string {
  const t = s.trim();
  return (t.startsWith('#') ? t : `#${t}`).toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

/** Darken a hex by `amount` (0–1) in HSL lightness space. */
function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const newL = Math.max(0, l - amount);
  const out = hslToRgb(h, s, newL);
  return rgbToHex(out.r, out.g, out.b);
}

// ─── Apply custom accent to <html> ────────────────────────────────────────────
// All the tokens overridden here are the ones derived from the primary in
// every preset theme: brand accent + deep variant + RGB triplet for Tailwind
// alpha modifiers + alpha-stamped glow/border/shadow.
// Surface/text/positive/negative stay at the base-theme defaults.

const CUSTOM_OVERRIDE_PROPS = [
  '--lf-sauce',
  '--lf-sauce-deep',
  '--color-accent',
  '--color-accent-dim',
  '--color-border-accent',
  '--color-accent-glow',
  '--shadow-accent-glow',
  '--shadow-accent-glow-hover',
  '--color-bg-subtle',
  '--lf-cream',
  '--lf-cream-deep',
];

/** Wash the accent with white to produce a very faint tinted neutral —
 *  used for hover backgrounds, elevated surfaces, and progress-bar tracks
 *  so the chrome reads as part of the same theme family. */
function washRgb(hex: string, mix: number): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  return {
    r: Math.round(r * (1 - mix) + 255 * mix),
    g: Math.round(g * (1 - mix) + 255 * mix),
    b: Math.round(b * (1 - mix) + 255 * mix),
  };
}

export function applyCustomAccent(hex: string) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { r, g, b } = hexToRgb(hex);
  const dim = darken(hex, 0.1);
  const dimRgb = hexToRgb(dim);
  // Hover-state tint: a very pale wash so nav hover, progress tracks, etc.
  // pick up the theme rather than falling through to a stale default tint.
  // NOTE: --color-bg-elevated is intentionally NOT overridden — the sidebar
  // uses that token and should stay a neutral off-white in every theme.
  const subtle = washRgb(hex, 0.92);
  const creamHex = rgbToHex(washRgb(hex, 0.94).r, washRgb(hex, 0.94).g, washRgb(hex, 0.94).b);
  const creamDeepHex = rgbToHex(washRgb(hex, 0.86).r, washRgb(hex, 0.86).g, washRgb(hex, 0.86).b);

  root.style.setProperty('--lf-sauce', hex);
  root.style.setProperty('--lf-sauce-deep', dim);
  root.style.setProperty('--color-accent', `${r} ${g} ${b}`);
  root.style.setProperty('--color-accent-dim', `${dimRgb.r} ${dimRgb.g} ${dimRgb.b}`);
  root.style.setProperty('--color-border-accent', `rgba(${r}, ${g}, ${b}, 0.30)`);
  root.style.setProperty('--color-accent-glow', `rgba(${r}, ${g}, ${b}, 0.10)`);
  root.style.setProperty('--shadow-accent-glow', `0 0 16px rgba(${r}, ${g}, ${b}, 0.18)`);
  root.style.setProperty('--shadow-accent-glow-hover', `0 0 20px rgba(${r}, ${g}, ${b}, 0.28)`);
  root.style.setProperty('--color-bg-subtle', `${subtle.r} ${subtle.g} ${subtle.b}`);
  root.style.setProperty('--lf-cream', creamHex);
  root.style.setProperty('--lf-cream-deep', creamDeepHex);
}

function clearCustomAccent() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const p of CUSTOM_OVERRIDE_PROPS) root.style.removeProperty(p);
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const VALID_THEME_IDS: ThemeId[] = THEMES.map((t) => t.id);

function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'monarch' || stored === 'classic') return 'minty';
  if (VALID_THEME_IDS.includes(stored as ThemeId)) return stored as ThemeId;
  return DEFAULT_THEME;
}

function readStoredCustomAccent(): string {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_ACCENT;
  const stored = window.localStorage.getItem(CUSTOM_ACCENT_KEY);
  if (stored && isValidHex(stored)) return normalizeHex(stored);
  return DEFAULT_CUSTOM_ACCENT;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  themes: ThemeDef[];
  customAccent: string;
  setCustomAccent: (hex: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());
  const [customAccent, setCustomAccentState] = useState<string>(() => readStoredCustomAccent());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
    if (theme === 'custom') {
      applyCustomAccent(customAccent);
    } else {
      clearCustomAccent();
    }
  }, [theme, customAccent]);

  const setTheme = useCallback((id: ThemeId) => setThemeState(id), []);

  const setCustomAccent = useCallback((hex: string) => {
    if (!isValidHex(hex)) return;
    const normalized = normalizeHex(hex);
    setCustomAccentState(normalized);
    window.localStorage.setItem(CUSTOM_ACCENT_KEY, normalized);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES, customAccent, setCustomAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
