import { BrandMark } from './BrandMark';

/**
 * Full-screen brand cover for the moments when there is nothing real to show:
 * the gap between the native splash hiding and a lazy chunk arriving, and the
 * window before the Face ID lock mounts.
 *
 * Deliberately free of Capacitor imports and lazy chunks so it can paint
 * synchronously — a cover that itself has to be fetched would defeat the point.
 *
 * Styled to hand off from the native splash without a visible step: `app-wash`
 * because the Shell root has it (a flat canvas visibly lightens at handoff), and
 * a tight, bold lockup because the splash artwork is ~800 weight with the mark
 * sitting close to the wordmark.
 */
export function BootCover() {
  return (
    <div
      className="ui-root app-wash fixed inset-0 z-[100] flex flex-col items-center justify-center bg-canvas"
      // Decorative, but the boot must still announce itself — marking the whole
      // cover aria-hidden leaves the accessibility tree empty for the entire
      // load, so VoiceOver has nothing to say and nothing to navigate.
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading LasagnaFi</span>
      {/* Not animated: the splash hands over a fully drawn mark, so the draw-in
          would read as the logo erasing itself and starting again. */}
      <BrandMark size={54} animate={false} />
      <p
        aria-hidden="true"
        className="mt-0.5 font-editorial text-[26px] font-bold tracking-[-0.015em] text-content"
      >
        Lasagna<span className="text-brand">Fi</span>
      </p>
    </div>
  );
}
