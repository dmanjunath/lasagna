import { Link } from 'wouter';
import { ArrowUpRight, MessageSquare, Plus, UserPlus } from 'lucide-react';
import { isAmountsHidden } from '../../lib/hide-amounts';
import { HiddenAmount, Skeleton } from '../uikit';
import type { QuickLink } from '../../lib/home-briefing';

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));

/** The greeting's type, shared with the page-level empty and failed states. */
export const GREETING_CLS =
  'font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-content';

const PLACEHOLDER_WIDTHS = ['w-[150px]', 'w-[160px]', 'w-[250px]', 'w-[180px]', 'w-[170px]', 'w-[200px]'];

const LINK_ICON: Record<string, typeof Plus> = { goal: Plus, invite: UserPlus };

/** Home's top card: greeting, a two-sentence summary, the top actions, quick links. */
export function BriefingCard({
  greeting,
  actionSentence,
  netWorth,
  summaryLoading,
  shortSummary = false,
  actions,
  links,
  linksLoading,
  linksPlaceholder = 4,
  onAsk,
}: {
  greeting: string;
  actionSentence: { count: string; lead: string; focus: string | null } | null;
  netWorth: { delta: number; since: string } | null;
  summaryLoading: boolean;
  /** Last time there were no actions, so only the net worth sentence: hold one line less. */
  shortSummary?: boolean;
  /** The ActionsSection, rendered by the page so its handlers stay there. */
  actions: React.ReactNode;
  links: QuickLink[];
  /** A fact a link depends on is still loading: hold the band's space instead. */
  linksLoading: boolean;
  /** How many placeholder links to hold room for while loading. */
  linksPlaceholder?: number;
  onAsk: (prompt: string) => void;
}) {
  const strong = 'font-semibold text-content';
  // Whole dollars, so a change under 50 cents reads "unchanged", never "up $0".
  const delta = netWorth ? Math.round(netWorth.delta) : 0;
  return (
    <section className="cq-inline relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm animate-fade-in">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[260px]"
        style={{
          background:
            'radial-gradient(60% 100% at 0% 0%, var(--ui-accent-softer), transparent 70%),' +
            'radial-gradient(50% 100% at 100% 0%, var(--ui-brand-softer), transparent 70%)',
        }}
        aria-hidden
      />
      <header className="relative px-5 sm:px-8 pt-7 sm:pt-8 pb-6 flex flex-col gap-3.5">
        <h1 className={GREETING_CLS}>
          {greeting}
        </h1>
        {summaryLoading ? (
          // Lines of the real sentence's height, so nothing moves when it lands.
          <div className="max-w-[600px] text-[16px] sm:text-[18px]" aria-hidden>
            <div className="flex h-[1.6em] items-center"><Skeleton className="h-[0.9em] w-full" /></div>
            {!shortSummary && <div className="flex h-[1.6em] items-center"><Skeleton className="h-[0.9em] w-full" /></div>}
            <div className="briefing-narrow-only h-[1.6em] items-center"><Skeleton className="h-[0.9em] w-1/2" /></div>
          </div>
        ) : (actionSentence || netWorth) && (
          <p className="max-w-[600px] text-[16px] sm:text-[18px] leading-[1.6] text-content-muted">
            {actionSentence && (
              <>
                You have <span className={strong}>{actionSentence.count}</span>
                {actionSentence.focus ? <>, {actionSentence.lead} <span className={strong}>{actionSentence.focus}</span>.</> : '.'}{' '}
              </>
            )}
            {netWorth && (
              <>
                Your net worth is{' '}
                {delta === 0 ? (
                  <span className={strong}>unchanged</span>
                ) : (
                  <span className={`font-semibold ${delta > 0 ? 'text-positive' : 'text-negative'}`}>
                    {delta > 0 ? 'up' : 'down'} {isAmountsHidden() ? <HiddenAmount className="[&>span]:![color:inherit]" /> : fmtUsd(delta)}
                  </span>
                )}{' '}
                {netWorth.since}.
              </>
            )}
          </p>
        )}
      </header>

      <div className="relative px-5 sm:px-8 pb-7">{actions}</div>

      {linksLoading ? (
        <div
          className="briefing-links relative gap-y-1 px-5 sm:px-8 pt-5 pb-6 bg-panel-inset border-t border-line"
          aria-hidden
        >
          {/* bg-line: the default skeleton fill is the band's own colour. */}
          {Array.from({ length: linksPlaceholder }, (_, i) => PLACEHOLDER_WIDTHS[i % PLACEHOLDER_WIDTHS.length]).map((w, i) => (
            <div key={i} className="flex items-center gap-2.5 min-h-[44px]">
              <Skeleton className="w-7 h-7 shrink-0 rounded-ui-sm bg-line" />
              <Skeleton className={`h-4 max-w-full bg-line ${w}`} />
            </div>
          ))}
        </div>
      ) : links.length > 0 && (
        <nav
          aria-label="Quick links"
          className="briefing-links relative gap-y-1 px-5 sm:px-8 pt-5 pb-6 bg-panel-inset border-t border-line"
        >
          {links.map((l) => {
            const Icon = l.kind === 'chat' ? MessageSquare : LINK_ICON[l.id] ?? ArrowUpRight;
            const icon = (
              <span
                className={`grid place-items-center w-7 h-7 shrink-0 rounded-ui-sm ${
                  l.kind === 'chat' ? 'bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]' : 'bg-brand-soft text-[rgb(var(--ui-brand-ink))]'
                }`}
                aria-hidden
              >
                <Icon className="h-[15px] w-[15px]" />
              </span>
            );
            const cls =
              'ui-focus flex items-center gap-2.5 min-h-[44px] rounded-ui-sm text-[15px] font-medium text-content hover:text-[rgb(var(--ui-brand-ink))] transition-colors text-left';
            return l.kind === 'page' ? (
              <Link key={l.id} href={l.href} className={cls}>{icon}{l.label}</Link>
            ) : (
              <button key={l.id} type="button" onClick={() => onAsk(l.prompt)} className={cls}>{icon}{l.label}</button>
            );
          })}
        </nav>
      )}
    </section>
  );
}
