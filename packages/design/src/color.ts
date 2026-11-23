// Small color math shared by the generators, the mobile adapter and the tests.

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(c: string): Rgba {
  const s = c.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) return { r: +fn[1], g: +fn[2], b: +fn[3], a: fn[4] === undefined ? 1 : +fn[4] };
  throw new Error(`Unsupported color: ${c}`);
}

/** The same color at a new opacity. */
export function withAlpha(c: string, a: number): string {
  const { r, g, b } = parseColor(c);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** A translucent color laid over an opaque one, as it renders. */
export function composite(top: string, under: string): string {
  const f = parseColor(top);
  const b = parseColor(under);
  if (b.a !== 1) throw new Error(`composite needs an opaque background, got ${under}`);
  const mix = (x: number, y: number) => Math.round(x * f.a + y * (1 - f.a));
  return `rgb(${mix(f.r, b.r)}, ${mix(f.g, b.g)}, ${mix(f.b, b.b)})`;
}

/** "R G B" for the web's triplet variables. Opaque colors only. */
export function toTriplet(c: string): string {
  const { r, g, b, a } = parseColor(c);
  if (a !== 1) throw new Error(`Triplet needs an opaque color, got ${c}`);
  return `${r} ${g} ${b}`;
}

function luminance(c: string): number {
  const { r, g, b } = parseColor(c);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio between two opaque colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
