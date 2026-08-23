import { BrandLockup } from './BrandLockup';

/**
 * Full-screen brand cover for the moments when there is nothing real to show:
 * the gap between the native splash hiding and a lazy chunk arriving, and the
 * window before the Face ID lock mounts.
 *
 * Deliberately free of Capacitor imports and lazy chunks so it can paint
 * synchronously — a cover that itself has to be fetched would defeat the point.
 * `app-wash` because the Shell root has it; a flat canvas visibly lightens at
 * the handoff.
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
      <BrandLockup />
    </div>
  );
}
