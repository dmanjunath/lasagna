import { useMemo, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useInsights } from '../hooks/useInsights';
import { api } from '../lib/api';
import { SimpleShell } from '../components/layout/simple-shell';

const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function SimpleAction() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { insights, isLoading, reload } = useInsights();
  const [busy, setBusy] = useState(false);

  // Optional ?id= query param picks a specific insight; otherwise top-priority.
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const requestedId = params.get('id');

  const action = useMemo(() => {
    if (requestedId) return insights.find((i) => i.id === requestedId);
    return [...insights].sort(
      (a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0),
    )[0];
  }, [insights, requestedId]);

  async function markDone() {
    if (!action || busy) return;
    setBusy(true);
    try {
      await api.actOnInsight(action.id);
      await reload();
      setLocation('/s');
    } finally {
      setBusy(false);
    }
  }

  async function snooze() {
    if (!action || busy) return;
    setBusy(true);
    try {
      await api.snoozeInsight(action.id, 24);
      await reload();
      setLocation('/s');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <SimpleShell title="Your next step" showBack>
        <div className="rounded-2xl bg-bg-elevated border border-rule animate-pulse h-44 mb-5" />
      </SimpleShell>
    );
  }

  if (!action) {
    return (
      <SimpleShell title="Your next step" showBack>
        <div className="rounded-2xl bg-bg-elevated border border-rule p-6 text-center">
          <div className="text-3xl mb-2">🎉</div>
          <div className="text-base font-serif font-medium">No action to take right now.</div>
          <p className="text-sm text-text-muted mt-2">
            You're caught up. New nudges will appear here as things change.
          </p>
        </div>
      </SimpleShell>
    );
  }

  // Sticky action CTAs — rendered via `bottomDock` so they stack ABOVE the
  // bottom nav rather than overlapping it. The shell handles safe-area
  // insets and z-index for us.
  const dock = (
    <div className="bg-bg/95 backdrop-blur border-t border-rule/60 px-4 py-3 flex gap-2">
      <button
        onClick={markDone}
        disabled={busy}
        className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium disabled:opacity-50 min-h-[44px]"
      >
        {busy ? '…' : 'I did this ✓'}
      </button>
      <button
        onClick={snooze}
        disabled={busy}
        className="rounded-xl bg-bg-elevated border border-rule text-text-secondary px-4 py-3 text-sm font-medium disabled:opacity-50 min-h-[44px]"
      >
        Snooze
      </button>
    </div>
  );

  return (
    <SimpleShell title="Your next step" showBack bottomDock={dock}>
      {/* Hero */}
      <section className="rounded-2xl bg-gradient-to-br from-cheese/15 to-accent/10 border border-cheese/40 p-5 mb-5">
        <div className="text-[11px] uppercase tracking-[0.16em] text-accent font-medium mb-2">
          {urgencyLabel(action.urgency)}
        </div>
        <h1 className="text-[28px] font-serif font-medium leading-[1.1]">{action.title}</h1>
        {action.impact && (
          <div className="mt-3 text-sm text-text-secondary">{action.impact}</div>
        )}
      </section>

      {/* Why this matters */}
      {action.description && (
        <section className="mb-5">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-2">
            Why this matters
          </h3>
          <div className="rounded-2xl bg-bg-elevated border border-rule p-5 shadow-sm">
            <p className="text-sm leading-relaxed text-text-secondary">{action.description}</p>
          </div>
        </section>
      )}

      {/* Talk it through */}
      <section className="mb-5">
        <button
          onClick={() => setLocation(`/s/chat?prompt=${encodeURIComponent(action.chatPrompt || `Tell me more about: ${action.title}`)}`)}
          className="w-full flex items-center justify-between p-4 rounded-2xl bg-bg-elevated border border-rule shadow-sm hover:border-accent/30 transition text-left"
        >
          <div className="flex items-center gap-3">
            <div className="text-xl">💬</div>
            <div>
              <div className="text-sm font-medium">Ask Lasagna about this</div>
              <div className="text-xs text-text-muted mt-0.5">Get the explanation in plain English</div>
            </div>
          </div>
          <div className="text-text-muted">›</div>
        </button>
      </section>

      {/* Spacer so the last content card clears the sticky CTA + bottom nav
          stack. Shell's pb-28 covers the nav alone; CTA dock adds ~64px. */}
      <div className="h-20" aria-hidden="true" />
    </SimpleShell>
  );
}

function urgencyLabel(urgency: string): string {
  if (urgency === 'critical') return 'Urgent · do this first';
  if (urgency === 'high') return 'High priority';
  if (urgency === 'medium') return "This week's focus";
  return 'When you get a chance';
}
