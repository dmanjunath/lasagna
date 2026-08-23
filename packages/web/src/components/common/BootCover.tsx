import { isNativeApp } from '../../lib/native';

/**
 * Full-screen brand cover for the moments when there is nothing real to show:
 * the gap between the native splash hiding and a lazy chunk arriving, and the
 * window before the Face ID lock mounts.
 *
 * Renders the same splash artwork the native side does (see `.boot-splash`),
 * not a CSS rebuild of it, so the lockup is pixel-identical across the handoff.
 * No Capacitor imports and no lazy chunks — a cover that has to be fetched
 * before it can paint would defeat the point.
 *
 * Native only. On the web there is no splash to hand off from, and the artwork
 * is a phone-shaped square: `cover` on a desktop viewport would crop it to a
 * strip and blow the lockup up. Web keeps the plain `null` fallback it had.
 */
export function BootCover() {
  if (!isNativeApp()) return null;
  return (
    <div
      className="boot-splash fixed inset-0 z-[100]"
      // Decorative, but the boot must still announce itself — marking the whole
      // cover aria-hidden leaves the accessibility tree empty for the entire
      // load, so VoiceOver has nothing to say and nothing to navigate.
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading LasagnaFi</span>
    </div>
  );
}
