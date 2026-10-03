import { useCallback, useEffect, useRef, useState } from 'react';

const EDGE = '22px';
/** EDGE plus room for an outward focus ring (4px) and 2px of slack. */
const RING_CLEARANCE = 'calc(22px + 6px)';

/** The mask for a list clipped at its top edge, its bottom edge, both, or neither. */
function maskFor(start: boolean, end: boolean): string | undefined {
  if (!start && !end) return undefined;
  const stops = [
    start ? `transparent, #000 ${EDGE}` : '#000',
    end ? `#000 calc(100% - ${EDGE}), transparent` : '#000',
  ];
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

/**
 * A fade at whichever edge of a scrolling list is currently clipping content.
 * Without one a clipped list ends flush against whatever follows, slicing a row
 * in half with nothing to say it could scroll — which is what both navs did once
 * the plan block joined their feet.
 *
 * Both edges, not just the far one: scrolled down, the TOP is the one cutting a
 * row in half, right under the brand lockup. Each edge is faded only while it is
 * actually clipping, so a list at either end never fades a row it is showing in
 * full.

 *
 * `deps` names anything that changes the content height without resizing any
 * element already being watched (a route change, a section opening).
 */
export function useScrollFade<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  const [clip, setClip] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const [pos, total, visible] = [el.scrollTop, el.scrollHeight, el.clientHeight];
    const start = pos > 4;
    const end = total - pos - visible > 4;
    // Bail when nothing moved: this runs on every scroll event, and a fresh
    // object each time would re-render the whole list at scroll frequency.
    setClip((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    // The scroller's own box is fixed by its parent's layout, so watching it
    // alone never sees its content grow. Watch the rows too, which also catches
    // a height mid-animation rather than only at its end — and re-watch them
    // when one is added or removed (the plan block appears once billing lands).
    const ro = new ResizeObserver(measure);
    const watch = () => {
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
    };
    watch();
    const mo = new MutationObserver(() => { measure(); watch(); });
    mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [measure, ...deps]);

  const mask = maskFor(clip.start, clip.end);
  const scrollPadding = mask ? { scrollPaddingBlock: RING_CLEARANCE } : undefined;

  return {
    ref,
    onScroll: measure,
    style: mask
      ? {
          maskImage: mask,
          WebkitMaskImage: mask,
          // Sequential focus scrolls a row only just into view, which parked it
          // flush against the ramp — so the ring of the row you had just
          // Tabbed to was the one thing the fade erased. scroll-padding
          // declares the ramp as outside the optimal viewing region, so the
          // browser lands the row clear of it.
          //
          // EDGE alone is not enough. `ui-focus` paints OUTWARD (2px canvas +
          // 4px brand), so the ring lives up to 4px beyond the row's own box
          // and the outer band still landed in the ramp. The extra 6px clears
          // that with 2px to spare. Inset rings do not need it, but the two
          // navs use different ring styles and one constant is cheaper than
          // teaching the hook which.
          ...scrollPadding,
        }
      : undefined,
    // A fade alone only reads as "more below" when the clip lands ON a row. Land
    // it in a gutter and the list looks finished, so callers whose overflow is
    // load-bearing render an explicit cue off this.
    clipped: clip,
  };
}
