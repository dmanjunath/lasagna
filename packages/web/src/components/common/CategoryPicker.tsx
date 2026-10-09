import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { ChevronDown, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { Button, button } from '../uikit';
import { taxonomyIcon, useTaxonomy } from '../../lib/taxonomy';
import { CategoryList } from './CategoryList';
import { TriggerInner, triggerClass, type ToolbarField } from './OptionMenu';

// ---------------------------------------------------------------------------
// CategoryPicker - every category dropdown's host: the trigger, and the panel
// the shared CategoryList renders in. Single mode recategorizes (pick one and
// close). Multi mode filters (toggle rows, the panel stays open).
//
// The panel portals to <body> and is fixed-positioned from the trigger rect so
// it can't be clipped by overflow-hidden ancestors (e.g. expanded groups on
// /transactions). On phones (≤639px) it renders as a bottom sheet copying the
// uikit Modal phone-tray idiom, stacked above the detail tray. Both portal
// roots carry data-sheet, so a host panel's outside-tap check can tell a tap
// in here from a tap elsewhere.
//
// Escape closes and refocuses the trigger (capture-phase, so a parent Modal's
// own Escape listener never fires while the picker is open).
// ---------------------------------------------------------------------------

const PANEL_WIDTH = 280;

type Single = { multiple?: false; value: string; onChange: (categoryId: string) => void };
type Multi = { multiple: true; values: string[]; onChangeMany: (categoryIds: string[]) => void };

export function CategoryPicker(props: (Single | Multi) & {
  /**
   * inline = the row's category label button; field = a form-field trigger
   * with the category's icon; action = a small secondary button showing
   * `currentLabel`; select = the shared dropdown trigger (OptionMenu's), as a
   * form field or, with `toolbar`, a toolbar button; pencil = the row's edit
   * pencil beside its category pill (`className` carries the pencil styling).
   */
  variant: 'inline' | 'field' | 'action' | 'select' | 'pencil';
  /** Display label: a value the picker can't offer, or the trigger text for action/select. */
  currentLabel?: string;
  /** select only: the toolbar trigger look (field name, tint, count). */
  toolbar?: ToolbarField;
  describedBy?: string;
  /** Categories never to offer (e.g. the one being deleted). */
  excludeIds?: string[];
  /** Single mode: a top "no category" row with this label, e.g. "Any category". */
  anyLabel?: string;
  /** The Manage categories footer (default on). Off inside forms. */
  showManage?: boolean;
  /** Fires when the panel opens (e.g. to dismiss a create-rule prompt). */
  onOpen?: () => void;
  className?: string;
}) {
  const { variant, currentLabel, toolbar, describedBy, excludeIds, anyLabel, showManage, onOpen, className } = props;
  const { byId } = useTaxonomy();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number; width: number }>({ left: 0, top: 0, maxHeight: 0, width: PANEL_WIDTH });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Swipe-to-dismiss for the phone bottom sheet: drag starts only from the
  // grab handle (not the scrollable list) via dragControls, as in uikit Modal.
  const dragControls = useDragControls();

  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;

  // The phone sheet floats over a document that still scrolls, so a drag on
  // a short category list would slide the page underneath instead.
  useBodyScrollLock(open && isPhone);

  const value = props.multiple ? '' : props.value;
  const current = value ? byId.get(value) : undefined;
  const triggerLabel = props.multiple ? (currentLabel ?? '') : (current?.name ?? currentLabel ?? 'Other');

  const updatePos = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // A form-field trigger gets a menu at least as wide as itself.
    const width = variant === 'field' || (variant === 'select' && !toolbar) ? Math.max(PANEL_WIDTH, rect.width) : PANEL_WIDTH;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    // Cap the panel to the space on its side of the trigger - the list shrinks
    // (search + footer stay pinned) instead of clipping past the viewport edge.
    if (window.innerHeight - rect.bottom < 380) {
      setPos({ left, width, bottom: window.innerHeight - rect.top + 6, maxHeight: rect.top - 14 });
    } else {
      setPos({ left, width, top: rect.bottom + 6, maxHeight: window.innerHeight - rect.bottom - 14 });
    }
  };

  const openPicker = () => {
    onOpen?.();
    if (!isPhone) updatePos();
    setOpen(true);
  };
  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };
  const pick = (id: string) => {
    if (!props.multiple && id !== props.value) props.onChange(id);
    close(true);
  };

  // Outside click closes; Escape closes and refocuses the trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Desktop: reposition on any scroll/resize so the panel tracks the trigger.
  useEffect(() => {
    if (!open || isPhone) return;
    const onMove = () => updatePos();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPhone]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) close();
    else openPicker();
  };
  const common = {
    type: 'button' as const,
    ref: triggerRef,
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-describedby': describedBy,
    onClick: toggle,
  };

  const trigger =
    variant === 'pencil' ? (
      <button {...common} aria-label={`Change category from ${triggerLabel}`} title="Change category" className={className}>
        <Pencil size={13} aria-hidden />
      </button>
    ) : variant === 'select' ? (
      <button {...common} className={cn('group/trigger', triggerClass(toolbar), className)}>
        <TriggerInner label={triggerLabel} toolbar={toolbar} />
      </button>
    ) : variant === 'action' ? (
      <button
        {...common}
        // Same shape as the page's toolbar dropdowns (OptionMenu's toolbar trigger).
        className={cn(button({ variant: 'secondary', size: 'sm' }), 'gap-1.5 pl-3 pr-2.5', className)}
      >
        {currentLabel}
        <ChevronDown size={15} className={cn('shrink-0 text-content-muted transition-transform duration-150', open && 'rotate-180')} aria-hidden />
      </button>
    ) : variant === 'inline' ? (
      <button
        {...common}
        title="Click to recategorize"
        className={cn(
          // A persistent dotted underline + darker ink so the category reads as
          // an editable control at rest, not static metadata. Truncates so a long
          // name never wraps the row's meta line.
          'ui-focus touch-target-inline min-w-0 max-w-full truncate rounded-ui-xs text-content-secondary underline decoration-dotted underline-offset-2 transition-colors hover:text-content',
          className,
        )}
      >
        {triggerLabel}
      </button>
    ) : (
      <button
        {...common}
        className={cn(
          'flex h-11 min-h-touch w-full items-center gap-2.5 rounded-ui-md bg-panel pl-3 pr-3 text-left text-sm text-content',
          'border border-line-strong shadow-ui-sm transition-[border-color,box-shadow] duration-150 ease-ui',
          'focus:outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]',
          className,
        )}
      >
        {/* No medallion for a placeholder ("Any category"): it isn't a category. */}
        {current && (
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-secondary">
            {taxonomyIcon(current)}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-semibold">{triggerLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
      </button>
    );

  const list = (scrollerClassName?: string) => (
    <CategoryList
      mode={props.multiple ? 'multi' : 'single'}
      selected={props.multiple ? props.values : value ? [value] : []}
      onPick={pick}
      onSetSelected={props.multiple ? props.onChangeMany : undefined}
      onManage={() => close()}
      // On a phone autofocus would shove the keyboard over the sheet.
      autoFocus={!isPhone}
      scrollerClassName={scrollerClassName}
      excludeIds={excludeIds}
      anyLabel={anyLabel}
      showManage={showManage}
    />
  );

  return (
    <>
      {trigger}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          // Clicks inside the portal still bubble through the React tree to the
          // clickable transaction row, so stop them here.
          isPhone ? (
            <div data-sheet className="fixed inset-0 z-[100]" onClick={(e) => e.stopPropagation()}>
              <div
                className="absolute inset-0 bg-black/45 backdrop-blur-[2px] [animation:ui-fade-in_160ms_ease-out]"
                onClick={() => close()}
                aria-hidden
              />
              <motion.div
                ref={panelRef}
                drag="y"
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.9 }}
                onDragEnd={(_e, info: PanInfo) => {
                  if (info.offset.y > 96 || info.velocity.y > 600) close();
                }}
                className="ui-root absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-ui-xl border-t border-line bg-panel-raised p-2 shadow-ui-xl [animation:ui-slide-up_220ms_cubic-bezier(0.22,1,0.36,1)]"
                // .ui-root paints the canvas background; keep the sheet raised.
                style={{ backgroundColor: 'rgb(var(--ui-panel-raised))' }}
              >
                <div
                  className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5"
                  onPointerDown={(e) => dragControls.start(e)}
                >
                  <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
                </div>
                {list('flex-1')}
                {/* Multi mode stays open while you pick, so the sheet needs a
                     way back that isn't a blind tap on the scrim. */}
                {props.multiple && (
                  <Button variant="secondary" size="sm" className="mt-1 w-full shrink-0" onClick={() => close(true)}>
                    Done
                  </Button>
                )}
              </motion.div>
            </div>
          ) : (
            <div
              ref={panelRef}
              data-sheet
              style={{
                position: 'fixed',
                left: pos.left,
                top: pos.top,
                bottom: pos.bottom,
                width: pos.width,
                maxHeight: pos.maxHeight,
                // .ui-root paints the canvas background; keep the panel raised.
                backgroundColor: 'rgb(var(--ui-panel-raised))',
              }}
              className="ui-root z-[95] flex flex-col rounded-ui-md border border-line bg-panel-raised p-1 shadow-ui-lg [animation:ui-pop-in_140ms_cubic-bezier(0.22,1,0.36,1)]"
              onClick={(e) => e.stopPropagation()}
            >
              {list()}
            </div>
          ),
          document.body,
        )}
    </>
  );
}
