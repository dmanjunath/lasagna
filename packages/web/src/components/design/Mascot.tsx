import { useEffect, useMemo, useRef } from 'react';
import { ARM_BOX, ARM_SHOULDER, BLINK_EVERY, BLINK_LIDS, BLINK_MS, BLINK_START, HELLO_WAVE, INTRO_DELAY, LID_BOX, LID_SVG, WAVE_HALF, splitWavingArm, type Theme } from '@lasagna/design';

/** The artwork as inline SVG filling its box. Its fixed outline color goes, so currentColor comes from the wrapper. */
function svgHtml(svg: string) {
  return svg.replace(/ color="[^"]*"/, '').replace('<svg ', '<svg width="100%" height="100%" aria-hidden="true" ');
}

const HELLO_KEY = 'lf-mascot-hello';

/** Whether the hello wave still has to play this browser session. Claims it, so it plays once. */
function takeHello(): boolean {
  try {
    if (sessionStorage.getItem(HELLO_KEY)) return false;
    sessionStorage.setItem(HELLO_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * The design's character (packages/design mascot art). In the artwork
 * currentColor is the outline, so it follows the text color here and stays
 * visible on a dark canvas. With `wave`, the raised arm is its own layer and
 * waves hello three times on the first showing in a session, the native app's
 * hello: only the arm moves. With `blink`, the happy artwork closes its eyes
 * for a moment every few seconds once the hello is over.
 */
export function Mascot({ theme, name = 'happy', className, wave = false, blink = false }: { theme: Theme; name?: 'happy' | 'sleepy'; className?: string; wave?: boolean; blink?: boolean }) {
  const svg = theme.mascot?.[name];
  const split = useMemo(() => (wave && svg ? splitWavingArm(svg) : null), [wave, svg]);
  const hasArm = !!split;
  const armRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const arm = armRef.current;
    if (!arm || typeof arm.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!takeHello()) return;
    // One half wave per segment, each eased like the native wave's sine timing.
    const frames = [0, ...HELLO_WAVE].map((deg) => ({ transform: `rotate(${deg}deg)`, easing: 'ease-in-out' }));
    const anim = arm.animate(frames, { duration: HELLO_WAVE.length * WAVE_HALF, delay: INTRO_DELAY });
    let done = false;
    anim.onfinish = () => { done = true; };
    return () => {
      anim.cancel();
      // Unmounted before it finished (a quick navigation, or React's development remount): the
      // session's hello is still owed, so the next showing plays it.
      if (!done) {
        try { sessionStorage.removeItem(HELLO_KEY); } catch { /* storage unavailable */ }
      }
    };
  }, [hasArm]);

  const blinks = blink && name === 'happy';
  const lidsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const lids = lidsRef.current;
    if (!lids || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Open for most of the cycle, then shut and open again in BLINK_MS.
    const shut = 1 - BLINK_MS / BLINK_EVERY;
    const frames = [
      { transform: 'scaleY(0)' },
      { transform: 'scaleY(0)', offset: shut },
      { transform: 'scaleY(1)', offset: shut + (1 - shut) / 2 },
      { transform: 'scaleY(0)' },
    ];
    const anims = Array.from(lids.children).flatMap((lid) =>
      typeof lid.animate === 'function' ? [lid.animate(frames, { duration: BLINK_EVERY, delay: BLINK_START, iterations: Infinity })] : [],
    );
    return () => anims.forEach((a) => a.cancel());
  }, [blinks]);

  if (!svg) return null;
  // Each lid starts open (scaled to nothing) and drops from its top edge.
  const lids = blinks ? (
    <span ref={lidsRef} aria-hidden>
      {BLINK_LIDS.map((l) => (
        <span
          key={l.x}
          className="absolute block"
          style={{
            left: `${(l.x / 140) * 100}%`,
            top: `${(l.y / 124) * 100}%`,
            width: `${(LID_BOX.w / 140) * 100}%`,
            height: `${(LID_BOX.h / 124) * 100}%`,
            transform: 'scaleY(0)',
            transformOrigin: '50% 0%',
          }}
          dangerouslySetInnerHTML={{ __html: svgHtml(LID_SVG) }}
        />
      ))}
    </span>
  ) : null;
  if (!split) {
    if (!lids) return <span className={className} aria-hidden dangerouslySetInnerHTML={{ __html: svgHtml(svg) }} />;
    return (
      <span className={className} aria-hidden style={{ position: 'relative' }}>
        <span className="absolute inset-0 block" dangerouslySetInnerHTML={{ __html: svgHtml(svg) }} />
        {lids}
      </span>
    );
  }
  // The arm layer is the artwork's box plus room to the right and above, so a wide wave is never clipped.
  return (
    <span className={className} aria-hidden style={{ position: 'relative' }}>
      <span className="absolute inset-0 block" dangerouslySetInnerHTML={{ __html: svgHtml(split.body) }} />
      <span
        ref={armRef}
        data-mascot-arm
        className="absolute block"
        style={{
          left: 0,
          top: `${(ARM_BOX.y / 124) * 100}%`,
          width: `${(ARM_BOX.w / 140) * 100}%`,
          height: `${(ARM_BOX.h / 124) * 100}%`,
          transformOrigin: `${ARM_SHOULDER.x * 100}% ${ARM_SHOULDER.y * 100}%`,
        }}
        dangerouslySetInnerHTML={{ __html: svgHtml(split.arm) }}
      />
      {lids}
    </span>
  );
}
