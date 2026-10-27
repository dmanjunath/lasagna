import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { Button, Surface, useToast } from '../uikit';
import { cn } from '../../lib/utils';

// Step index for each stage the user can stop on. The percentage is the one
// the onboarding progress bar shows on that step, (index + 1) of 4 screens,
// so the two never disagree.
const STAGE_STEP: Record<string, number> = { profile: 0, income: 1, lifestyle: 2, accounts: 3, complete: 3 };
const SCREENS = 4;

/** Null unless the user chose "Finish later" and has not finished since. */
function useDeferredOnboarding() {
  const { user, setOnboardingDeferred } = useAuth();
  const [resuming, setResuming] = useState(false);
  const toast = useToast();
  if (!user?.onboardingDeferred || user.onboardingStage === null) return null;

  const index = STAGE_STEP[user.onboardingStage] ?? 0;
  const resume = async () => {
    setResuming(true);
    try {
      await api.updateOnboardingDeferred(false);
      // The app gate then opens onboarding on the step the server has stored.
      setOnboardingDeferred(false);
    } catch {
      toast({ tone: 'negative', title: 'Could not open setup', description: 'Please try again.' });
    } finally {
      setResuming(false);
    }
  };
  return { pct: Math.round(((index + 1) / SCREENS) * 100), step: index + 1, resume, resuming };
}

function Meter({ pct }: { pct: number }) {
  // Decorative: the percentage is always stated in text beside it.
  return (
    <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-canvas-sunken">
      <div className="h-full rounded-full bg-brand transition-[width] duration-500 ease-ui" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Compact row for the foot of the sidebar and the mobile drawer. */
export function OnboardingProgress({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const d = useDeferredOnboarding();
  if (!d) return null;
  return (
    <button
      type="button"
      onClick={() => { onNavigate?.(); void d.resume(); }}
      disabled={d.resuming}
      aria-label={`Finish setup, ${d.pct}% done`}
      className={cn('ui-focus block min-h-11 w-full rounded-ui-md px-2 py-1.5 text-left transition-colors hover:bg-brand-softer', className)}
    >
      {/* Same colours as the PlanUsage row below it: muted label, value in secondary. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-content-muted">Finish setup</span>
        <span className="flex items-center gap-1 ui-tnum text-[11.5px] font-semibold text-content-secondary">
          {d.pct}% done
          {/* The row's only control cue on touch, where there is no hover fill. */}
          <ArrowRight className="h-3.5 w-3.5 text-content-muted" aria-hidden />
        </span>
      </div>
      <div className="mt-1.5"><Meter pct={d.pct} /></div>
    </button>
  );
}

/** The home screen's card: the same progress, with room to say what is left. */
export function OnboardingResumeCard({ className }: { className?: string }) {
  const d = useDeferredOnboarding();
  if (!d) return null;
  return (
    <Surface tone="panel" className={cn('flex flex-col gap-4 sm:flex-row sm:items-center', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-content">Finish setting up</h2>
          <span className="ui-tnum text-[13px] font-semibold text-content-muted">{d.pct}% done</span>
        </div>
        <p className="mt-1 text-[13px] text-content-secondary">
          Your plan is built from these answers. You stopped at step {d.step} of 3.
        </p>
        <div className="mt-3"><Meter pct={d.pct} /></div>
      </div>
      {/* Secondary: on an empty home the page's own "Connect an account" is the primary. */}
      <Button variant="secondary" onClick={d.resume} loading={d.resuming} disabled={d.resuming}
        trailingIcon={<ArrowRight className="h-4 w-4" />} className="shrink-0">
        Continue
      </Button>
    </Surface>
  );
}
