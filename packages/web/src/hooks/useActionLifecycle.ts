import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/** What was done to a row. One verb per press, and one row per verb. */
export type ActionVerb = 'completed' | 'snoozed' | 'dismissed';

/**
 * How long a press waits before it is sent.
 *
 * No restore endpoint exists, so undo is a LOCAL reversal: the one-way commit
 * is deferred until the window elapses and until then there is nothing to put
 * back. A second verb inside the window flushes the first, and unmounting
 * commits whatever is still waiting, so nothing is silently dropped.
 */
const UNDO_WINDOW_MS = 6000;

/**
 * One fixed snooze period, with no menu.
 *
 * These regenerate monthly, so "ask me again next month" is the only period the
 * data supports, and a self-describing label beats a popover with its own open
 * state, focus trap and mobile treatment.
 */
const SNOOZE_HOURS = 720;

const SEND: Record<ActionVerb, (id: string) => Promise<unknown>> = {
  completed: (id) => api.actOnInsight(id),
  snoozed: (id) => api.snoozeInsight(id, SNOOZE_HOURS),
  dismissed: (id) => api.dismissInsight(id),
};

const CONFIRMATION: Record<ActionVerb, string> = {
  completed: 'Marked done',
  snoozed: 'Snoozed for a month',
  dismissed: 'Dismissed',
};

/**
 * A page that quietly claims a smaller number than the server holds is worse
 * than an error, so a refused commit puts the row and its share of every total
 * back and says so.
 */
const COMMIT_FAILED = "Couldn't save that, so it is still here.";

/**
 * The one lifecycle behind every action row: complete, snooze, dismiss, undo.
 *
 * All three remove the row immediately, which is required rather than merely
 * nice: the money sentence above the list is the sum of the rows a reader can
 * add up, so it has to recompute the moment one leaves. Undo restores both.
 *
 * `rootRef` goes on the element that contains the rows, and is what the focus
 * handover searches: each row is found by its `data-action-id`.
 */
export function useActionLifecycle() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ id: string; verb: ActionVerb } | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Whether the person has done anything on this visit.
   *
   * This, and not any fact about the fetched rows, is what separates "you
   * cleared the list" from "we found nothing": a count of rows flips false the
   * moment a commit removes the last one.
   */
  const [everActed, setEverActed] = useState(false);

  const pendingRef = useRef<{ id: string; verb: ActionVerb } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The row undo has just put back, waiting for its header to exist again. */
  const restoreRef = useRef<string | null>(null);
  /**
   * Whether the press that opened the pill came from the keyboard.
   *
   * Read off `:focus-visible` on the pressed control, which is exactly the
   * question: the browser sets it when the person is navigating by keyboard and
   * leaves it clear for a click or a tap.
   */
  const viaKeyboardRef = useRef(false);

  const show = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const commit = useCallback(async (id: string, verb: ActionVerb) => {
    try {
      await SEND[verb](id);
    } catch {
      show(id);
      setFailed(true);
    }
  }, []);

  /**
   * Move focus off the pill BEFORE it closes.
   *
   * Deliberately not an effect on the state going null: the pill animates out
   * over 0.2s, so it still holds focus at that moment and the browser has
   * already dropped the user on <body> by the time the effect could act.
   * Stepping off it while it is still mounted is the only deterministic point.
   *
   * Only when focus is genuinely ON the pill, which is the whole reason the step
   * exists, and never scrolling to wherever it lands: the handover target is the
   * first row of the list, so a reader who had scrolled down and dismissed a row
   * with the mouse watched the page throw itself back to the top six seconds
   * later, with no input of their own.
   */
  const stepFocusOffPill = useCallback(() => {
    if (document.activeElement !== undoRef.current) return;
    const nextRow = rootRef.current?.querySelector<HTMLElement>(
      '[data-action-id] [role="button"]',
    );
    (nextRow ?? rootRef.current)?.focus({ preventScroll: true });
  }, []);

  const act = useCallback(
    (id: string, verb: ActionVerb) => {
      setEverActed(true);
      const pressed = document.activeElement;
      viaKeyboardRef.current =
        pressed instanceof HTMLElement && pressed.matches(':focus-visible');
      // Flush an in-flight press first, or a second verb inside the window
      // would drop the first one's commit on the floor.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        const inflight = pendingRef.current;
        if (inflight) void commit(inflight.id, inflight.verb);
      }
      setFailed(false);
      setHidden((prev) => new Set([...prev, id]));
      pendingRef.current = { id, verb };
      setPending({ id, verb });
      timerRef.current = setTimeout(() => {
        void commit(id, verb);
        timerRef.current = null;
        stepFocusOffPill();
        pendingRef.current = null;
        setPending(null);
      }, UNDO_WINDOW_MS);
    },
    [commit, stepFocusOffPill],
  );

  const undo = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const inflight = pendingRef.current;
    if (inflight) {
      // The row comes back, so focus goes back to it rather than to the top of
      // the list. It is not in the DOM until this render commits, which is why
      // the handover is finished by the effect below. The pill is still mounted
      // through its exit, so nothing lands on <body> in between.
      restoreRef.current = inflight.id;
      show(inflight.id);
    } else {
      stepFocusOffPill();
    }
    pendingRef.current = null;
    setPending(null);
  }, [stepFocusOffPill]);

  // Commit anything still waiting when the page goes, so a press is never lost.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        const inflight = pendingRef.current;
        if (inflight) void SEND[inflight.verb](inflight.id).catch(() => {});
      }
    };
  }, []);

  // Focus the undo as the pill opens. The window is 6s and the control is the
  // last thing in the DOM, so a keyboard user would spend all of it tabbing
  // toward a button that is about to disappear.
  //
  // KEYBOARD PRESSES ONLY. A click or a tap never asked for focus to go
  // anywhere, and pulling it into the pill is what left it there to be stepped
  // off the list six seconds later, dragging the viewport with it.
  useEffect(() => {
    if (pending && viaKeyboardRef.current) undoRef.current?.focus({ preventScroll: true });
  }, [pending]);

  // The failure says its piece and goes. The clock starts when it is actually
  // VISIBLE: a refusal raised behind an open confirmation would otherwise spend
  // its whole life hidden and never appear at all.
  useEffect(() => {
    if (!failed || pending) return;
    const t = setTimeout(() => setFailed(false), 5000);
    return () => clearTimeout(t);
  }, [failed, pending]);

  // Hand focus back to the restored row's header, wherever in the list it landed.
  useEffect(() => {
    const id = restoreRef.current;
    if (!id) return;
    restoreRef.current = null;
    const header = rootRef.current?.querySelector<HTMLElement>(
      `[data-action-id="${id}"] [role="button"]`,
    );
    (header ?? rootRef.current)?.focus({ preventScroll: true });
  }, [hidden]);

  return {
    /** Ids that are off screen right now, committed or merely pending. */
    hidden,
    everActed,
    act,
    undo,
    undoRef,
    rootRef,
    message: pending ? CONFIRMATION[pending.verb] : null,
    failure: failed ? COMMIT_FAILED : null,
  };
}
