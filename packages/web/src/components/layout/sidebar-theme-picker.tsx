import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Check } from 'lucide-react';
import { useTheme, isValidHex, normalizeHex, type ThemeId } from '../../lib/theme';

/**
 * Compact theme picker that lives at the bottom of the sidebar.
 *
 * Renders a row of small swatches (one per preset) plus a Custom slot.
 * Clicking the Custom slot opens a popover with a native color input + hex
 * text input — same mechanics as the standalone picker, just shrunk to fit
 * the 220px sidebar gutter.
 */
export function SidebarThemePicker() {
  const { theme, setTheme, themes, customAccent, setCustomAccent } = useTheme();
  const [customOpen, setCustomOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(customAccent);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const customButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setHexDraft(customAccent); }, [customAccent]);

  // Anchor the popover to the right of the custom swatch in viewport
  // coordinates. Uses position: fixed (via portal) to escape the sidebar's
  // overflow clip.
  useLayoutEffect(() => {
    if (!customOpen || !customButtonRef.current) return;
    const rect = customButtonRef.current.getBoundingClientRect();
    setPopoverPos({
      top: Math.max(16, rect.top - 8),
      left: rect.right + 12,
    });
  }, [customOpen]);

  useEffect(() => {
    if (!customOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        customButtonRef.current && !customButtonRef.current.contains(target)
      ) {
        setCustomOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [customOpen]);

  return (
    <div className="ds-side-theme">
      <div className="ds-side-theme__row">
        {themes.map((t) => {
          const active = t.id === theme;
          if (t.id === 'custom') {
            return (
              <button
                key={t.id}
                ref={customButtonRef}
                type="button"
                className={`ds-side-theme__swatch is-custom ${active ? 'is-active' : ''}`}
                onClick={() => setCustomOpen((v) => !v)}
                aria-label={`Custom theme · current ${customAccent}`}
                title="Custom"
                style={{ background: customAccent }}
              >
                {active ? (
                  <Check size={11} strokeWidth={3} className="ds-side-theme__check" />
                ) : (
                  <Palette size={11} strokeWidth={2.2} className="ds-side-theme__icon" />
                )}
              </button>
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id as ThemeId)}
              aria-label={`${t.label} theme`}
              title={t.label}
              className={`ds-side-theme__swatch ${active ? 'is-active' : ''}`}
              style={{ background: t.swatches[0] }}
            >
              {active && <Check size={11} strokeWidth={3} className="ds-side-theme__check" />}
            </button>
          );
        })}
      </div>

      {customOpen && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="ds-side-theme__popover"
          role="dialog"
          aria-label="Custom accent"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          <div className="ds-side-theme__pop-title">Custom accent</div>
          <div className="ds-side-theme__pop-inputs">
            <input
              type="color"
              value={customAccent}
              onChange={(e) => {
                setCustomAccent(e.target.value);
                if (theme !== 'custom') setTheme('custom');
              }}
              aria-label="Pick accent"
              className="ds-side-theme__pop-color"
            />
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => {
                if (isValidHex(hexDraft)) {
                  setCustomAccent(normalizeHex(hexDraft));
                  if (theme !== 'custom') setTheme('custom');
                } else {
                  setHexDraft(customAccent);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setCustomOpen(false);
              }}
              spellCheck={false}
              maxLength={7}
              className="ds-side-theme__pop-hex"
              aria-label="Hex"
            />
          </div>
          <p className="ds-side-theme__pop-hint">Lasagna derives the deep variant, glow, and shadows.</p>
        </div>,
        document.body,
      )}

      <style>{`
        .ds-side-theme {
          padding: 8px 12px 4px;
          position: relative;
        }
        .ds-side-theme__row {
          display: grid;
          grid-template-columns: repeat(5, 24px);
          justify-content: space-between;
          row-gap: 8px;
        }
        .ds-side-theme__swatch {
          position: relative;
          width: 24px;
          height: 24px;
          justify-self: center;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 50%;
          padding: 0;
          cursor: pointer;
          transition: transform 0.12s, box-shadow 0.15s, border-color 0.15s;
          display: grid;
          place-items: center;
          color: white;
        }
        .ds-side-theme__swatch:hover {
          transform: scale(1.12);
          box-shadow: 0 0 0 1px var(--lf-rule);
        }
        .ds-side-theme__swatch.is-active {
          box-shadow: 0 0 0 2px var(--lf-paper), 0 0 0 3px var(--lf-sauce);
          border-color: transparent;
        }
        .ds-side-theme__check { color: white; }
        .ds-side-theme__icon { color: rgba(255,255,255,0.8); }
        .ds-side-theme__swatch.is-custom {
          background-image: conic-gradient(from 0deg, #EC4899, #F97316, #EAB308, #10B981, #0EA5E9, #6366F1, #EC4899);
        }
        .ds-side-theme__popover {
          position: fixed;
          width: 240px;
          padding: 12px 14px 14px;
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule);
          border-radius: 12px;
          box-shadow: var(--shadow-card-hover);
          z-index: 50;
        }
        .ds-side-theme__pop-title {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--lf-muted);
          margin-bottom: 8px;
        }
        .ds-side-theme__pop-inputs {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .ds-side-theme__pop-color {
          appearance: none;
          -webkit-appearance: none;
          width: 36px;
          height: 28px;
          padding: 0;
          border: 1px solid var(--lf-rule);
          border-radius: 8px;
          background: transparent;
          cursor: pointer;
          overflow: hidden;
        }
        .ds-side-theme__pop-color::-webkit-color-swatch-wrapper { padding: 0; }
        .ds-side-theme__pop-color::-webkit-color-swatch { border: none; border-radius: 6px; }
        .ds-side-theme__pop-color::-moz-color-swatch { border: none; border-radius: 6px; }
        .ds-side-theme__pop-hex {
          flex: 1;
          padding: 6px 10px;
          border: 1px solid var(--lf-rule);
          border-radius: 8px;
          background: var(--lf-surface);
          color: var(--lf-ink);
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 12px;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .ds-side-theme__pop-hex:focus {
          outline: none;
          border-color: var(--lf-sauce);
          box-shadow: 0 0 0 3px var(--color-accent-glow);
        }
        .ds-side-theme__pop-hint {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 11px;
          color: var(--lf-muted);
          margin: 8px 0 0;
          line-height: 1.45;
        }
      `}</style>
    </div>
  );
}
