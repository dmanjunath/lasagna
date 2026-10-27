import { useId, useRef, type ReactNode } from 'react';
import { motion, useAnimate, useReducedMotion } from 'framer-motion';
import { Check, Minus, Plus } from 'lucide-react';
import { Label } from '../uikit';
import { cn } from '../../lib/utils';

// ─── Motion ──────────────────────────────────────────────
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Children of a <Stagger> rise in one after another when the step mounts. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }}>
      {children}
    </motion.div>
  );
}

export function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className}
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}>
      {children}
    </motion.div>
  );
}

// ─── The lasagna ─────────────────────────────────────────
// One layer per finished step and a top layer at the finish, the brand mark's
// own three-wave motif stacked into a dish.
const BANDS = [
  { y: 104, fill: 'var(--ui-viz-3)' },
  // viz-2, not viz-4: that coral is the same red as --ui-negative.
  { y: 78, fill: 'var(--ui-viz-2)' },
  { y: 52, fill: 'rgb(var(--ui-brand))' },
  { y: 26, fill: 'var(--ui-viz-3)' },
];
const bandPath = (y: number) =>
  `M8 ${y} C30 ${y - 12} 52 ${y - 12} 74 ${y} S118 ${y + 12} 140 ${y} S184 ${y - 12} 206 ${y} ` +
  `L206 ${y + 20} C184 ${y + 8} 162 ${y + 8} 140 ${y + 20} S96 ${y + 32} 74 ${y + 20} S30 ${y + 8} 8 ${y + 20} Z`;

/** `layers` is how many bands are filled in. The newest one drops into place. */
export function LasagnaLayers({ layers, className }: { layers: number; className?: string }) {
  return (
    <svg viewBox="0 0 214 150" aria-hidden="true" className={cn('h-auto overflow-visible', className)}>
      <rect x="4" y="128" width="206" height="14" rx="7" fill="rgb(var(--ui-content) / 0.08)" />
      {BANDS.map((b, i) => {
        const on = i < layers;
        const isNew = i === layers - 1;
        return (
          <motion.path
            key={i}
            d={bandPath(b.y)}
            fill={b.fill}
            initial={isNew ? { y: -38, opacity: 0 } : false}
            animate={{ y: 0, opacity: on ? 1 : 0.16 }}
            transition={isNew
              ? { y: { type: 'spring', stiffness: 320, damping: 18, delay: 0.15 }, opacity: { duration: 0.3, delay: 0.15 } }
              : { duration: 0.4 }}
          />
        );
      })}
    </svg>
  );
}

// ─── Progress ────────────────────────────────────────────
/** Three segments. The current one glows, with a slow sheen across it. */
export function SegmentProgress({ step, className }: { step: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex gap-1.5', className)}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-canvas-sunken">
          <motion.div
            className="absolute inset-0 rounded-full bg-brand"
            initial={false}
            animate={{ scaleX: i <= step ? 1 : 0 }}
            style={{
              originX: 0,
              boxShadow: i === step ? '0 0 12px 1px rgb(var(--ui-brand) / 0.55)' : undefined,
            }}
            transition={{ duration: 0.6, ease: EASE }}
          />
          {i === step && (
            <motion.div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(90deg, transparent, rgb(255 255 255 / 0.55), transparent)' }}
              initial={{ x: '-100%' }}
              animate={{ x: ['-100%', '100%', '100%'] }}
              transition={{ duration: 2.4, times: [0, 0.6, 1], ease: EASE, repeat: Infinity, delay: 0.5 }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** The rail's step list: done steps get a check, the current one a halo. */
export function StepList({ steps, step }: { steps: string[]; step: number }) {
  return (
    <ol className="grid gap-1">
      {steps.map((label, i) => {
        const done = i < step;
        const cur = i === step;
        return (
          <li key={label} aria-current={cur ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-semibold transition-[background-color,color,box-shadow] duration-300 ease-ui',
              cur ? 'bg-panel/70 text-content shadow-ui-sm' : 'text-content-muted',
            )}>
            <span className={cn(
              'grid h-[22px] w-[22px] flex-none place-items-center rounded-full border-[1.5px] text-[11px] ui-tnum transition-all duration-300 ease-ui',
              done ? 'border-brand bg-brand text-brand-fg'
              : cur ? 'border-brand text-[rgb(var(--ui-brand-ink))] shadow-[0_0_0_4px_var(--ui-brand-soft)]'
              : 'border-line-heavy',
            )}>
              {done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            {label}
            {done && <span className="sr-only">(done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Choice controls ─────────────────────────────────────
/** A labelled group for controls that are not one input. */
export function ChoiceField({ label, hint, required, children }: {
  label: string; hint?: ReactNode; required?: boolean; children: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <Label id={`${id}-label`}>
        {label}
        {required && <span className="ml-0.5 text-brand">*</span>}
      </Label>
      <div role="group" aria-labelledby={`${id}-label`} className="mt-2">{children}</div>
      {hint && <p className="mt-1.5 text-[12px] text-content-muted">{hint}</p>}
    </div>
  );
}

// One size for every typed answer and one for every choice, across all of
// onboarding. Typed answers are large so they read at a glance. Choices sit a
// step smaller so a row of them still fits on a phone.
export const VALUE_TEXT = 'text-[20px] font-bold';
// Placeholders keep the size but not the weight, or "Alex" reads as a name
// already typed in grey.
export const VALUE_INPUT = `h-[52px] ${VALUE_TEXT} placeholder:font-normal`;
export const CHOICE_TEXT = 'text-[15px] font-semibold';

const pressable = 'ui-focus transition-[border-color,background-color,color,box-shadow,transform] duration-150 ease-ui';

/** Pill chips. The chosen one gains a check that pops in. */
export function PillChips<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
            className={cn(
              pressable,
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 active:scale-[0.97]',
              CHOICE_TEXT,
              active
                ? 'border-brand bg-brand-soft text-[rgb(var(--ui-brand-ink))]'
                : 'border-line-heavy bg-panel text-content-secondary hover:border-brand/60',
            )}>
            {active && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.3, ease: EASE }}
                className="grid h-3.5 w-3.5 place-items-center rounded-full bg-brand text-brand-fg">
                <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />
              </motion.span>
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const cardBase = cn(
  pressable,
  'rounded-ui-lg border text-left hover:-translate-y-0.5 hover:shadow-ui-md',
  CHOICE_TEXT,
);
const cardOn = 'border-brand bg-brand-softer text-content shadow-[0_0_0_3px_var(--ui-brand-soft)] hover:shadow-[0_0_0_3px_var(--ui-brand-soft)]';
const cardOff = 'border-line-heavy bg-panel text-content-secondary';

/** Tall cards with an icon tile, for a short list of kinds (type of work). */
export function IconCards<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string; icon: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
            className={cn(cardBase, 'flex flex-col gap-2.5 p-3.5', active ? cardOn : cardOff)}>
            <span className={cn(
              'grid h-[34px] w-[34px] place-items-center rounded-[10px] transition-colors duration-150',
              active ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))]' : 'bg-canvas-sunken text-content-muted',
            )}>
              {o.icon}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Row cards with a small drawing on the right (how far a bad year drops). */
export function LineCards<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: string; path: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
            className={cn(cardBase, 'flex items-center justify-between gap-3 px-3.5 py-3', active ? cardOn : cardOff)}>
            <span>{o.label}</span>
            <svg viewBox="0 0 74 22" aria-hidden="true" className="h-[22px] w-[74px] flex-none">
              <path d={o.path} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={cn('transition-[stroke] duration-150', active ? 'stroke-brand' : 'stroke-content-faint')} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

/** Round number buttons (how many people depend on you). */
export function RoundPicker({ options, value, onChange }: {
  options: Array<{ value: number; label: string; ariaLabel?: string }>;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={active} aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            className={cn(
              pressable,
              'h-12 w-12 rounded-full border ui-tnum',
              CHOICE_TEXT,
              active
                ? 'scale-[1.06] border-brand bg-brand text-brand-fg shadow-[0_4px_14px_rgb(var(--ui-brand)/0.3)]'
                : 'border-line-heavy bg-panel text-content-secondary hover:border-brand/60',
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A number with − and + either side. The middle is still a text field, so
 * someone moving 65 to 50 types it rather than tapping fifteen times.
 */
export function NumberStepper({ id, value, onChange, min, max, decLabel, incLabel, describedBy }: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  decLabel: string;
  incLabel: string;
  describedBy?: string;
}) {
  const n = Number(value) || 0;
  // Clearing the field and leaving it puts back the last real age, rather
  // than saving a blank the user never sees.
  const lastValid = useRef(value || String(min));
  if (value) lastValid.current = value;
  const set = (next: number) => onChange(String(Math.max(min, Math.min(max, next))));
  // The number bumps when − or + changes it. Driven imperatively: keying the
  // input on its value remounted it on every keystroke and dropped focus, so
  // only one digit could ever be typed.
  const [scope, animate] = useAnimate<HTMLInputElement>();
  const stepBy = (d: number) => {
    set(n + d);
    void animate(scope.current, { y: [-3, 0] }, { duration: 0.3, ease: EASE });
  };
  const stepBtn = cn(
    pressable,
    'grid h-11 w-11 place-items-center rounded-[10px] bg-canvas-sunken text-content-secondary hover:text-content disabled:opacity-40',
  );
  return (
    <div className="inline-flex items-center gap-1 rounded-ui-lg border border-line-heavy bg-panel p-1 shadow-ui-sm focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--ui-brand-soft)]">
      <button type="button" aria-label={decLabel} className={stepBtn} disabled={n <= min} onClick={() => stepBy(-1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <input
        ref={scope}
        id={id}
        type="text"
        inputMode="numeric"
        maxLength={2}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => (value ? set(n) : onChange(lastValid.current))}
        className={cn('w-[76px] bg-transparent text-center ui-tnum text-content outline-none', VALUE_TEXT)}
      />
      <button type="button" aria-label={incLabel} className={stepBtn} disabled={n >= max} onClick={() => stepBy(1)}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

// ─── Finish ──────────────────────────────────────────────
const BURST_COLOURS = ['rgb(var(--ui-brand))', 'var(--ui-viz-3)', 'var(--ui-viz-4)', 'rgb(var(--ui-brand) / 0.6)'];

/** The check pops in, a ring spreads, and a few flecks fly out once. */
export function FinishBurst({ icon }: { icon: ReactNode }) {
  // Reduced motion stops transforms but not opacity, which left the flecks
  // and ring sitting already scattered while they faded. Show only the check.
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className="relative grid h-24 w-24 place-items-center" aria-hidden="true">
        <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-brand text-brand-fg shadow-[0_10px_30px_rgb(var(--ui-brand)/0.35)]">
          {icon}
        </span>
      </div>
    );
  }
  return (
    <div className="relative grid h-24 w-24 place-items-center" aria-hidden="true">
      <motion.span className="absolute inset-0 rounded-full border-2 border-brand"
        initial={{ scale: 0.7, opacity: 0.8 }} animate={{ scale: 1.6, opacity: 0 }}
        transition={{ duration: 1.1, ease: EASE, delay: 0.35 }} />
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        const r = 64 + (i % 3) * 14;
        return (
          <motion.i key={i} className="absolute left-1/2 top-1/2 -ml-1 -mt-1 h-2 w-2 rounded-[3px]"
            style={{ background: BURST_COLOURS[i % 4] }}
            initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
            animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r, rotate: 160, opacity: 0 }}
            transition={{ duration: 1, ease: EASE, delay: 0.35 + (i % 4) * 0.03 }} />
        );
      })}
      <motion.span
        className="grid h-[72px] w-[72px] place-items-center rounded-full bg-brand text-brand-fg shadow-[0_10px_30px_rgb(var(--ui-brand)/0.35)]"
        initial={{ scale: 0 }} animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.1 }}>
        {icon}
      </motion.span>
    </div>
  );
}
