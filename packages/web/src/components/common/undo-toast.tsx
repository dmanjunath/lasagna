import { forwardRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * The pill that confirms a completed, snoozed or dismissed action, and offers
 * the undo that reverses it.
 *
 * One slot, two messages: the confirmation while the window runs, and the
 * failure if the commit is refused after it. Both pages that run this lifecycle
 * hand-rolled their own copy of this and the two had already drifted.
 */
export const UndoToast = forwardRef<
  HTMLButtonElement,
  {
    /** The confirmation, or null when nothing is waiting out its window. */
    message: string | null;
    /** The refusal, or null. Shown only once the confirmation has gone. */
    failure: string | null;
    onUndo: () => void;
  }
>(function UndoToast({ message, failure, onUndo }, undoRef) {
  return (
    <AnimatePresence>
      {(message || failure) && (
        <motion.div
          key={message ? 'undo' : 'failed'}
          initial={{ opacity: 0, x: '-50%', y: 12 }}
          animate={{ opacity: 1, x: '-50%', y: 0 }}
          exit={{ opacity: 0, x: '-50%', y: 12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          // A refusal is not a confirmation. `role="status"` is polite, and a
          // polite region that swaps one message for another is often not
          // re-announced at all, so the one message a reader must not miss was
          // the one most likely to pass in silence.
          role={message ? 'status' : 'alert'}
          // Clears the mobile tab bar, which is `fixed bottom-0 z-30` and hides
          // at `md`. At `bottom-6` the pill sat on top of it and took three tabs
          // out of reach for the whole window.
          //
          // `w-max` is load-bearing: a fixed element's containing block is the
          // viewport, so `left-1/2` alone left it 195px of a 390px screen and
          // the message broke across two lines mid-phrase.
          className={`fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-1/2 z-[60] flex w-max max-w-[calc(100vw-2rem)] items-center gap-4 rounded-ui-md px-[18px] py-3 text-[14px] shadow-ui-md md:bottom-6${
            message ? '' : ' ring-1 ring-[rgb(var(--ui-negative))]/40'
          }`}
          // Two states, two paints. The failure was pixel-identical to the
          // confirmation, so a refused commit looked exactly like a committed
          // one.
          //
          // The tint over the panel rather than a solid --ui-negative fill: the
          // token flips to a light coral in dark mode, where white text on it
          // measures about 2:1. Soft tint plus negative ink is the design
          // system's own destructive idiom and is AA on the tint in both modes.
          // The gradient is how a translucent tint gets an opaque base, so the
          // page does not show through the pill.
          style={
            message
              ? { background: 'rgb(var(--ui-content))', color: 'rgb(var(--ui-panel))' }
              : {
                  background:
                    'linear-gradient(var(--ui-negative-soft), var(--ui-negative-soft)), rgb(var(--ui-panel))',
                  color: 'rgb(var(--ui-negative))',
                }
          }
        >
          {message ? (
            <>
              <span className="font-semibold">{message}</span>
              <button
                ref={undoRef}
                type="button"
                onClick={onUndo}
                // Not `ui-focus`: its ring paints a gap in `--ui-canvas`, which
                // is the LIGHT page colour, so on this near-black pill it read
                // as a white halo. The gap has to be the pill's own background.
                className="touch-target rounded-ui-sm font-bold underline underline-offset-[3px] focus:outline-none focus-visible:shadow-[0_0_0_2px_rgb(var(--ui-content)),0_0_0_4px_var(--ui-brand-ring)]"
              >
                Undo
              </button>
            </>
          ) : (
            <span className="font-semibold">{failure}</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
