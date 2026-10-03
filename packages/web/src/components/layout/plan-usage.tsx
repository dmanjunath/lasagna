import { useState } from 'react';
import { useLocation } from 'wouter';
import { CircleMinus, Sparkles } from 'lucide-react';
import { useBilling, startUpgrade } from '../../lib/billing';
import { Button, useToast } from '../uikit';
import { cn } from '../../lib/utils';

/**
 * Free-plan institution usage, stated once for the whole app.
 *
 * Renders only on the free plan and only once something is linked: "0 of 2"
 * tells a first-run user nothing, and the zero state's job is the connect CTA.
 *
 * Lives at the foot of the sidebar and the foot of the mobile drawer, so
 * hitting the cap is never a surprise discovered mid-connect.
 */
export function PlanUsage({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { status } = useBilling();
  const [location, navigate] = useLocation();
  const toast = useToast();
  // The checkout session is a round trip, and with no pending state three
  // impatient taps opened three of them. Matches PlanCard, which always resets,
  // because on native startUpgrade resolves as soon as the browser sheet is
  // presented and this page stays mounted.
  //
  // EVERY hook stays above the guard below. Declared after it, this one only ran
  // on the renders that returned content — so a free tenant whose billing call
  // landed after mount (~400ms, an ordinary cold start) went from 3 hooks to 4
  // and React threw "Rendered more hooks than during the previous render",
  // taking the whole authenticated app down to the boot boundary.
  const [upgrading, setUpgrading] = useState(false);

  if (!status || status.plan !== 'free' || status.usage.institutions <= 0) return null;

  const { institutions, maxInstitutions } = status.usage;
  // Always denominated by the CAP and clamped, so the bar fills as you connect
  // banks and stays full past the cap. Denominating by the total made connecting
  // a third bank drain a full meter to two thirds.
  const usedPct = Math.min(100, (institutions / Math.max(1, maxInstitutions)) * 100);
  const overLimit = institutions > maxInstitutions;
  // The bar turns AT the cap, not one past it: a full brand-green bar over "You
  // have reached your plan limit" read as complete rather than as the one state
  // this block exists to warn about.
  const atLimit = institutions >= maxInstitutions;

  const upgrade = async () => {
    setUpgrading(true);
    try {
      await startUpgrade();
    } catch (err) {
      toast({ tone: 'negative', title: err instanceof Error ? err.message : 'Failed to start upgrade' });
    } finally {
      setUpgrading(false);
    }
  };

  // Each recovery gets its own row rather than sitting inline in a sentence. As
  // links they were ~17px tall, and padding them to a real target made the two
  // boxes OVERLAP once the sentence wrapped — a click on the Upgrade underline
  // landed on "disconnect one" and went to /accounts instead of Stripe. Ghost is
  // the quietest variant, left-aligned and full width so these read as rows
  // rather than as a pitch.
  //
  // The leading icon is not decoration. It gives the row a control shape on
  // touch, where there is no hover pill to reveal one, and it holds a fixed slot
  // for the pending spinner — `loading` swaps Loader2 into it, so the label
  // cannot shift while the row waits on Stripe.
  const actionClass = '-mx-2 w-[calc(100%+1rem)] justify-start px-2 text-[12px] font-semibold';

  return (
    <div className={cn('px-1', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-[11.5px] font-semibold text-content-muted">Free plan</span>
        {/* Under the cap the reading is a fraction of it. Past the cap a
            fraction would read "4 of 2", which looks like a bug rather than a
            state, so it becomes two plain counts instead — carrying the noun,
            because the same string appears on /accounts beside "24 accounts". */}
        <span className="ui-tnum text-[11.5px] font-semibold text-content-secondary">
          {overLimit
            ? `${institutions} institutions, ${maxInstitutions} syncing`
            : `${institutions} of ${maxInstitutions} institutions`}
        </span>
      </div>
      {/* Decorative: the reading above already states both numbers, and what
          the amber fill means is spelled out in the line below. */}
      <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas-sunken">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-ui"
          // viz-3, not `--ui-caution`, which is the only other amber in the
          // system: that one is tuned as warning TEXT (140 86 0 in light, a
          // brown) and paints a muddy bar. viz-3 is the hue every other amber
          // bar in the app already uses.
          style={{
            width: `${usedPct}%`,
            background: atLimit ? 'var(--ui-viz-3)' : 'rgb(var(--ui-brand))',
          }}
        />
      </div>
      {atLimit && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {/* Over the cap the reading above already names the shortfall, so
              there is nothing left to state and the rows go straight on. */}
          {!overLimit && (
            <p className="mb-0.5 text-[11.5px] leading-[1.45] text-content-muted">
              You've reached your plan limit.
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={actionClass}
            onClick={upgrade}
            loading={upgrading}
            disabled={upgrading}
            leadingIcon={<Sparkles className="h-4 w-4" />}
          >
            {overLimit ? 'Upgrade to sync them all' : 'Upgrade for 50 institutions'}
          </Button>
          {/* Already on the page that does the disconnecting: the row would
              navigate to where you are and look broken. */}
          {overLimit && !location.startsWith('/accounts') && (
            <Button
              variant="ghost"
              size="sm"
              className={actionClass}
              onClick={() => { onNavigate?.(); navigate('/accounts'); }}
              leadingIcon={<CircleMinus className="h-4 w-4" />}
            >
              Disconnect one to free a slot
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
