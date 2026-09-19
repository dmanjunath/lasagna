import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { Surface } from '../uikit/Surface';
import { cn } from '../../lib/utils';

/**
 * Admin-only control for trying display faces against real figures.
 *
 * The face is a CSS variable (`--ui-display`) rather than a literal, because
 * `font-display` and `font-editorial` resolve at build time and could not
 * otherwise be changed at runtime.
 *
 * Only the shipped face is in index.html. Every other family is fetched the
 * first time it is picked, so nobody downloads six families to read their
 * balance. The choice and its stylesheet URL are stored together, and a small
 * script in index.html replays both before first paint.
 */
const KEY = 'lasagna-display-font';

type Face = { id: string; label: string; stack: string; href?: string; note: string };

const SHIPPED: Face = {
  id: 'instrument',
  label: 'Instrument Sans',
  // Figures resolve to Figtree through the LF Numerals unicode-range face.
  stack: '"LF Numerals", "Instrument Sans"',
  note: 'current, figures in Figtree',
};

const FACES: Face[] = [
  SHIPPED,
  {
    id: 'bricolage', label: 'Bricolage Grotesque', stack: '"Bricolage Grotesque"',
    href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&display=swap',
    note: 'previous',
  },
  {
    id: 'space', label: 'Space Grotesk', stack: '"Space Grotesk"',
    href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap',
    note: 'distinctive figures',
  },
  {
    id: 'archivo', label: 'Archivo', stack: '"Archivo"',
    href: 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&display=swap',
    note: 'neutral, wide figures',
  },
  {
    id: 'figtree', label: 'Figtree', stack: '"Figtree"',
    href: 'https://fonts.googleapis.com/css2?family=Figtree:wght@500;600;700;800&display=swap',
    note: 'soft, round figures',
  },
  {
    id: 'manrope', label: 'Manrope', stack: '"Manrope"',
    href: 'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap',
    note: 'tight, even figures',
  },
  {
    id: 'jakarta', label: 'Plus Jakarta Sans', stack: '"Plus Jakarta Sans"',
    note: 'same as body text',
  },
];

function loadFace(face: Face) {
  if (!face.href || document.querySelector(`link[data-face="${face.id}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = face.href;
  link.dataset.face = face.id;
  document.head.appendChild(link);
}

function readSaved(): string {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw?.id ?? SHIPPED.id;
  } catch {
    return SHIPPED.id;
  }
}

export function DisplayFontPicker() {
  const { user } = useAuth();
  const [active, setActive] = useState(readSaved);

  if (!user?.isAdmin) return null;

  const apply = (face: Face) => {
    loadFace(face);
    document.documentElement.style.setProperty('--ui-display', face.stack);
    setActive(face.id);
    try {
      if (face.id === SHIPPED.id) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify({ id: face.id, stack: face.stack, href: face.href }));
    } catch {
      /* private mode: the choice just will not survive a reload */
    }
  };

  return (
    <Surface className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-content">Display face</h2>
        <span className="rounded-ui-sm bg-canvas-sunken px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-content-muted">
          Admin
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-content-muted">
        Changes every heading and money figure, for you only. Each sample below is
        set in the face it names.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {FACES.map((face) => (
          <button
            key={face.id}
            type="button"
            onClick={() => apply(face)}
            aria-pressed={active === face.id}
            style={{ fontFamily: `${face.stack}, system-ui, sans-serif` }}
            onMouseEnter={() => loadFace(face)}
            className={cn(
              'ui-focus touch-target rounded-ui-md border p-3 text-left transition-[border-color,background-color,box-shadow]',
              active === face.id
                ? 'border-transparent bg-brand-soft ring-1 ring-[var(--ui-brand-ring)]'
                : 'border-line bg-panel hover:border-line-strong hover:shadow-ui-sm',
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-bold text-content">{face.label}</span>
              <span className="text-[15px] font-bold tabular-nums text-content">$155,300</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-3">
              <span className="font-sans text-[11px] text-content-muted">{face.note}</span>
              <span className="text-[13px] font-semibold tabular-nums text-content-secondary">
                22.9% and 1,234,567,890
              </span>
            </div>
          </button>
        ))}
      </div>
    </Surface>
  );
}
