import { BrandMark } from './BrandMark';

/**
 * The mark over the wordmark, defined once.
 *
 * BootCover and BiometricLock both take the whole screen during boot and hand
 * off to one another, so any difference in gap, weight or size between them
 * reads as the logo jumping and restyling mid-launch. They had exactly that.
 *
 * Spacing follows the app's existing lockup (login, the lock screen) rather
 * than the splash artwork — the artwork has the mark and wordmark contiguous,
 * and copying that made the cover look cramped and then jump when the next
 * screen applied normal spacing.
 *
 * Not animated by default: everything using this is taking over from a splash
 * that already shows the mark fully drawn, so the draw-in reads as the logo
 * erasing itself and starting over.
 */
export function BrandLockup({ size = 54, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <div className="flex flex-col items-center" aria-hidden="true">
      <BrandMark size={size} animate={animate} />
      <p className="mt-4 font-editorial text-[26px] font-medium tracking-[-0.015em] text-content">
        Lasagna<span className="text-brand">Fi</span>
      </p>
    </div>
  );
}
