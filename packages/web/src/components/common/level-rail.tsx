// Shared financial-level visuals — the "honest progress" segmented rail and its
// legend swatch, plus the state mapper. Used by the /financial-level hero and the
// home page's level summary so the two never drift.

// State drives the whole palette. Four intentional, token-only states:
//   done    → brand green (filled) · settled, earned
//   current → brand green (loud)   · the focal "you are here"
//   future  → neutral faint        · quiet, ahead of you
//   skipped → neutral faint, struck
export type LevelState = 'done' | 'current' | 'future' | 'skipped';

export function levelStateOf(
  step: { id: string; status: string },
  currentStepId: string,
  skipped: Set<string>,
): LevelState {
  if (step.status === 'complete') return 'done';
  if (skipped.has(step.id)) return 'skipped';
  if (step.id === currentStepId) return 'current';
  return 'future';
}

// ── SegmentedRail — one equal-height segment per level, colored only by STATE
// (never index or height, since completion is non-linear): done = brand-green
// fill, current = green with a ring/halo + a centred marker dot ("you are here"),
// future = quiet neutral track, skipped = muted dashed outline. ──
// `labels` (optional) makes each segment reveal its level on hover via a small
// tooltip — used on the home summary where there's no level list below the rail.
// Segments stay non-interactive (plain spans, no click).
export function SegmentedRail({ states, labels }: { states: LevelState[]; labels?: string[] }) {
  return (
    // Segments are capped so a short path reads as a short row of steps rather
    // than as three slab-sized buttons. At 12+ they are narrower than the cap,
    // so the long case is unchanged.
    <div className="flex items-stretch gap-[6px] h-10 px-1.5" aria-hidden="true">
      {states.map((st, i) => {
        const label = labels?.[i];
        const base = 'group/seg relative flex-1 min-w-0 max-w-[52px] rounded-[6px] transition-colors';
        const tip = label ? (
          <span
            className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-ui-md px-2.5 py-1.5 text-[11.5px] font-semibold shadow-ui-md group-hover/seg:block"
            style={{ background: 'rgb(var(--ui-content))', color: 'rgb(var(--ui-panel))' }}
          >
            {label}
          </span>
        ) : null;
        if (st === 'done')
          return <span key={i} className={base} style={{ background: 'rgb(var(--ui-brand))' }}>{tip}</span>;
        if (st === 'current')
          return (
            <span
              key={i}
              className={`${base} grid place-items-center`}
              style={{
                background: 'rgb(var(--ui-brand))',
                boxShadow: '0 0 0 2px rgb(var(--ui-panel)), 0 0 0 4px var(--ui-brand-ring)',
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: 'rgb(var(--ui-brand-fg))' }} />
              {tip}
            </span>
          );
        if (st === 'skipped')
          return (
            <span
              key={i}
              className={base}
              style={{ border: '1.5px dashed color-mix(in srgb, rgb(var(--ui-content-faint)) 60%, transparent)' }}
            >
              {tip}
            </span>
          );
        return (
          <span
            key={i}
            className={base}
            style={{ background: 'color-mix(in srgb, rgb(var(--ui-content-faint)) 22%, transparent)' }}
          >
            {tip}
          </span>
        );
      })}
    </div>
  );
}

// Small swatch that mirrors a SegmentedRail segment for the legend.
export function LegendSwatch({ state }: { state: LevelState }) {
  if (state === 'current')
    return (
      <span
        className="grid place-items-center w-[11px] h-[11px] rounded-[3px] shrink-0 bg-brand"
        style={{ boxShadow: '0 0 0 1.5px var(--ui-brand-ring)' }}
      >
        <span className="w-[4px] h-[4px] rounded-full" style={{ background: 'rgb(var(--ui-brand-fg))' }} />
      </span>
    );
  if (state === 'done')
    return <span className="w-[11px] h-[11px] rounded-[3px] shrink-0 bg-brand" />;
  if (state === 'skipped')
    return (
      <span
        className="w-[11px] h-[11px] rounded-[3px] shrink-0"
        style={{ border: '1.5px dashed color-mix(in srgb, rgb(var(--ui-content-faint)) 60%, transparent)' }}
      />
    );
  return (
    <span
      className="w-[11px] h-[11px] rounded-[3px] shrink-0"
      style={{ background: 'color-mix(in srgb, rgb(var(--ui-content-faint)) 22%, transparent)' }}
    />
  );
}
