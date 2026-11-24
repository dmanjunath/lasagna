import { useEffect, useMemo, useRef } from 'react';
import { ARM_BOX, ARM_SHOULDER, HELLO_WAVE, INTRO_DELAY, WAVE_HALF, splitWavingArm, type Theme } from '@lasagna/design';

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
 * hello: only the arm moves.
 */
export function Mascot({ theme, name = 'happy', className, wave = false }: { theme: Theme; name?: 'happy' | 'sleepy'; className?: string; wave?: boolean }) {
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

  if (!svg) return null;
  if (!split) return <span className={className} aria-hidden dangerouslySetInnerHTML={{ __html: svgHtml(svg) }} />;
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
    </span>
  );
}
