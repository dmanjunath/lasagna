import type { ReactNode } from 'react';
import { Alert, Button } from '../uikit';
import { exactSyncTime, formatRelativeTime } from '../../lib/utils';
import { PLAN_STALE_DAYS, type PlanFreshness, type PlanTimestamps } from '../../lib/plan-freshness';

type BannerAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Keep a control that already has an icon or a tooltip looking like itself. */
  icon?: ReactNode;
  title?: string;
};

/**
 * Tells the user their plan has gone out of date, or that they have never
 * generated one. Renders nothing in every other case, so a caller can drop it in
 * unconditionally.
 *
 * The action's label is the caller's, because the same message leads somewhere
 * different depending on where it appears: the plan list opens the plan, the
 * plan itself rebuilds in place.
 */
export function PlanFreshnessBanner({
  freshness,
  refresh,
  generate,
  planName,
  className,
}: {
  freshness: PlanFreshness<PlanTimestamps>;
  refresh: BannerAction;
  /** Only pass this where the never-generated variant can appear. */
  generate?: BannerAction;
  /**
   * Name the plan the message is about. Pass it wherever the user can see more
   * than one plan, so "open plan" is not a guess between identical cards. Omit
   * it on the plan's own page, where "this plan" is the page you are reading,
   * and on any page that already has a section of the same name, where the
   * title reads as a stale feature rather than a stale document.
   */
  planName?: string;
  className?: string;
}) {
  if (freshness.kind === 'stale') {
    const written = freshness.generatedAt ? new Date(freshness.generatedAt) : null;
    const exact = freshness.generatedAt ? exactSyncTime(freshness.generatedAt) : null;
    return (
      <Alert
        tone="caution"
        title={
          planName
            ? `${planName} is more than ${PLAN_STALE_DAYS} days old`
            : `This plan is more than ${PLAN_STALE_DAYS} days old`
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh.onClick}
            disabled={refresh.disabled}
            title={refresh.title}
            leadingIcon={refresh.icon}
          >
            {refresh.label}
          </Button>
        }
        className={className}
      >
        {written && (
          <>
            Written <span title={exact ?? undefined}>{formatRelativeTime(written)}</span>.{' '}
          </>
        )}
        Refresh it so it reflects the accounts and balances you have now.
      </Alert>
    );
  }

  if (freshness.kind === 'none' && generate) {
    return (
      <Alert
        tone="info"
        title="You have not generated a retirement plan yet"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={generate.onClick}
            disabled={generate.disabled}
            title={generate.title}
            leadingIcon={generate.icon}
          >
            {generate.label}
          </Button>
        }
        className={className}
      >
        A plan reads your real accounts and writes up where you stand and what to do next. We
        recommend generating one.
      </Alert>
    );
  }

  return null;
}
