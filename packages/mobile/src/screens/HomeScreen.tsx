import { toActionRow } from "@web/lib/action-rows";
import { useEffect, useState } from "react";
import { insightsApi } from "@/api/home";
import { useAuth } from "@/auth/AuthProvider";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { ActionsSection } from "@/components/home/ActionsSection";
import { AskCard, ShortcutsCard } from "@/components/home/AskCard";
import { BillNote } from "@/components/home/BillNote";
import { GoalsCard } from "@/components/home/GoalsCard";
import { GreetingCard } from "@/components/home/GreetingCard";
import { HomeEmptyState } from "@/components/home/HomeEmptyState";
import { JourneyCard } from "@/components/home/JourneyCard";
import { useStepMark } from "@/components/journey/useStepMark";
import { NetWorthCard } from "@/components/home/NetWorthCard";
import { OnboardingResumeCard } from "@/components/home/OnboardingResumeCard";
import { RecentActivityCard } from "@/components/home/RecentActivityCard";
import { changeWords, SpendingCard } from "@/components/home/SpendingCard";
import { useHomeData } from "@/components/home/useHomeData";
import { openChat } from "@/lib/chat";
import {
  balanceValue,
  breakdownFrom,
  firstNameOf,
  greetingForHour,
  hasComposition,
  homeState,
  thisMonthPeriod,
  thisMonthTransactionsHref,
  upcomingBill,
} from "@/lib/home";
import { actionSentence, netWorthChange, quickLinks } from "@/lib/home-briefing";
import { currentStep, stepHelpPrompt } from "@/lib/journey";
import { openPath } from "@/lib/navigation";
import { hideSplashOnce } from "@/lib/splash";
import { AccountButton } from "@/shell/NavButtons";
import { useTheme as useDesign } from "@/design";
import { CardSkeleton } from "@/ui/Card";
import { failed } from "@/ui/feedback";
import { CardError } from "@/ui/State";
import { BrandWordmark } from "@/ui/BrandMark";
import { ScreenScroll } from "@/ui/ScreenScroll";

// Quick links a card on this screen already offers: the goals card's own
// "Set a savings goal", and the spending card's See all.
const LINKS_ON_CARDS = new Set(["goal", "spending"]);
// A shortcut names the page it opens. A question reads like something to ask,
// and questions belong in the chat card.
const SHORTCUT_LABEL: Record<string, string> = { retirement: "Retirement outlook" };

function useGreeting() {
  const [greeting, setGreeting] = useState(() => greetingForHour(new Date().getHours()));
  useEffect(() => {
    const id = setInterval(() => setGreeting(greetingForHour(new Date().getHours())), 60_000);
    return () => clearInterval(id);
  }, []);
  return greeting;
}

export default function Home() {
  const { user, tenant } = useAuth();
  const isOwner = user?.role === "owner";
  const d = useHomeData(isOwner);
  const greeting = `${useGreeting()}, ${firstNameOf(user, tenant)}`;
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Done, Snooze, Not for me: the one shared lifecycle. Rows done on this visit stay, ticked, with a sparkle.
  const verbs = useActionVerbs();
  const now = d.now;
  const actionsInGreeting = useDesign().skin.greeting === "card";

  const state = homeState(d.facts.data, d.facts.isError);
  const breakdown = d.facts.data && state === "dashboard" ? breakdownFrom(d.facts.data) : null;
  const insights = d.insights.data?.insights ?? [];

  // ── Briefing ──────────────────────────────────────────────────────────────
  const briefingActions = d.insights.isError ? null : actionSentence(insights);
  const lastVisit = d.lastVisit.data?.lastVisitAt ? new Date(d.lastVisit.data.lastVisitAt) : null;
  const briefingNetWorth =
    breakdown && d.history.data ? netWorthChange(d.history.data.history, breakdown.netWorth, lastVisit, new Date()) : null;
  const goalsKnown = d.goals.isSuccess;
  const links = quickLinks({
    goalCategories: goalsKnown ? d.goals.data.goals.map((g) => g.category) : null,
    hasRealEstate: d.balances.data ? d.balances.data.balances.some((b) => b.type === "real_estate") : null,
    canInvite: isOwner,
    household: d.household.data ?? null,
    now,
  });
  const chatPrompts = links.flatMap((l) => (l.kind === "chat" ? [{ label: l.label, prompt: l.prompt }] : []));
  const pageLinks = links.flatMap((l) =>
    l.kind === "page" && !LINKS_ON_CARDS.has(l.id) ? [{ id: l.id, label: SHORTCUT_LABEL[l.id] ?? l.label, href: l.href }] : [],
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const generate = async () => {
    setGenerating(true);
    try {
      await insightsApi.generate();
      await d.insights.refetch();
    } catch {
      failed("Couldn't generate actions. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  // ── Journey ───────────────────────────────────────────────────────────────
  // The journey page marks steps the same way. The card moves on to another step, so the toast's Undo is the way back.
  const { mark } = useStepMark();
  const markStep = async (status: "done" | "not_applicable") => {
    const step = currentStep(d.path.data);
    if (step) await mark(step, status);
  };

  // ── This month ────────────────────────────────────────────────────────────
  const period = thisMonthPeriod(now);
  const monthName = now.toLocaleString("en-US", { month: "long" });
  // The screen's one handwritten note: a rise in net worth, else a drop in spending.
  const netWorthUp = !!briefingNetWorth && Math.round(briefingNetWorth.delta) > 0;
  const spendingNote = !netWorthUp && !!d.flow.data && !!changeWords(d.flow.data)?.less;
  const bill = d.recurring.data ? upcomingBill(d.recurring.data.recurring, now) : null;
  const billAccount = (() => {
    const b = bill?.accountId ? d.balances.data?.balances.find((x) => x.accountId === bill.accountId) : undefined;
    return b ? { name: b.name, balance: balanceValue(b) } : null;
  })();

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await d.refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const actions = (
    <ActionsSection
      actions={insights}
      done={verbs.done.map((r) => r.title)}
      loading={d.insights.isPending}
      failed={d.insights.isError}
      generating={generating}
      onRetry={() => void d.insights.refetch()}
      onGenerate={() => void generate()}
      onComplete={(row) => verbs.complete(toActionRow(row))}
      onSnooze={verbs.snooze}
      onDismiss={verbs.dismiss}
    />
  );

  const empty = state === "empty" || state === "failed";
  // The greeting is Home's title: first in the content, scrolling away under the bar, which then shows the wordmark.
  const greetingCard = empty ? (
    <GreetingCard greeting={greeting} actionSentence={null} netWorth={null} loading={false} speaker={false} />
  ) : (
    // The greeting skin decides where the actions sit: their own card, or inside the greeting's.
    <GreetingCard
      greeting={greeting}
      actionSentence={briefingActions}
      netWorth={briefingNetWorth}
      loading={!breakdown || d.insights.isPending || d.history.isPending || d.lastVisit.isPending}
    >
      {actionsInGreeting ? actions : null}
    </GreetingCard>
  );

  return (
    <>
      <AccountButton />
      <ScreenScroll
        title="Home"
        root
        header={greetingCard}
        barTitle={<BrandWordmark />}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        // The launch screen stays up until Home has laid out, so no blank frame shows between them.
        onLayout={hideSplashOnce}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {empty ? (
          <>
            <OnboardingResumeCard />
            <HomeEmptyState
              kind={state}
              onAction={() => (state === "empty" ? openPath("/accounts?autoLink=true") : void d.facts.refetch())}
            />
          </>
        ) : (
          <>
            <OnboardingResumeCard />
            {actionsInGreeting ? null : actions}
            {!breakdown ? (
              <>
                <CardSkeleton lines={5} />
                <CardSkeleton lines={3} />
              </>
            ) : (
              <>
                <JourneyCard
                  path={d.path.data}
                  loading={d.path.isPending}
                  onAllSteps={() => openPath("/financial-level")}
                  onHelp={() => {
                    const step = currentStep(d.path.data);
                    if (step) openChat(stepHelpPrompt(step));
                  }}
                  onDid={() => markStep("done")}
                  onSetAside={() => markStep("not_applicable")}
                  onSetupProfile={() => openPath("/profile")}
                />
                {hasComposition(breakdown) ? <NetWorthCard breakdown={breakdown} onView={() => openPath("/accounts")} /> : null}
                {d.flow.isPending ? (
                  <CardSkeleton lines={5} />
                ) : d.flow.isError ? (
                  <CardError title="Couldn't load this month's spending" onRetry={() => void d.flow.refetch()} />
                ) : (
                  <SpendingCard
                    flow={d.flow.data}
                    month={monthName}
                    note={spendingNote}
                    onAll={() => openPath(`/spending?period=${period}`)}
                    onCategory={(id) => openPath(thisMonthTransactionsHref(id, now))}
                  />
                )}
                {d.goals.isError ? (
                  <CardError title="Couldn't load your goals" onRetry={() => void d.goals.refetch()} />
                ) : (
                  <GoalsCard
                    goals={d.goals.data?.goals ?? []}
                    loading={d.goals.isPending}
                    onOpen={(id) => openPath(`/goals/${id}`)}
                    onAll={() => openPath("/goals")}
                  />
                )}
                {d.recent.isPending ? (
                  <CardSkeleton lines={4} />
                ) : d.recent.isError ? (
                  <CardError title="Couldn't load recent activity" onRetry={() => void d.recent.refetch()} />
                ) : (
                  <RecentActivityCard txns={d.recent.data.transactions} onAll={() => openPath("/transactions?fresh=1")} />
                )}
                {bill ? <BillNote bill={bill} account={billAccount} /> : null}
                <AskCard prompts={chatPrompts} onAsk={(text) => openChat(text)} />
                <ShortcutsCard links={pageLinks} onOpen={(href) => openPath(href)} />
              </>
            )}
          </>
        )}
      </ScreenScroll>
    </>
  );
}

