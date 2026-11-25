import { useQuery } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { Fragment, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { debtApi } from "@/api/debt";
import { homeApi, insightsApi } from "@/api/home";
import { ActionGroup } from "@/components/actions/ActionGroup";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { accountTypeRole, accountTypeSymbol } from "@/components/accounts/AccountRow";
import { InputRow } from "@/components/accounts/FormFields";
import { Allocation } from "@/components/allocation/Allocation";
import { CategoryMedallion } from "@/components/CategoryMedallion";
import { composite, withAlpha } from "@lasagna/design";
import { useTheme as useDesign } from "@/design";
import { openAccountEdit, openAddAccount } from "@/lib/account-sheets";
import { openChat } from "@/lib/chat";
import {
  blendedApr,
  buildPlan,
  debtFacts,
  debtName,
  debtSegments,
  debtTypeLabel,
  extraHint,
  extraInvalid,
  heroSentence,
  isHighRate,
  orderStatement,
  parseExtra,
  paymentLine,
  payoffMonth,
  startingExtra,
  STRATEGIES,
  strategyNotes,
  toDebtPage,
  addMonths,
  type DebtAccount,
  type PayoffStrategy,
} from "@/lib/debt";
import { formatMoney } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { openPath } from "@/lib/navigation";
import { transactionsHref } from "@/lib/txn-filters";
import { pageActions } from "@/lib/page-actions";
import { figures, icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardHeader, CardSkeleton, TextLink } from "@/ui/Card";
import { Divider, SectionHeader } from "@/ui/Form";
import { ScopePills } from "@/components/transactions/ScopeRow";
import { HeroAmount } from "@/ui/HeroAmount";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { EmptyState, ErrorState } from "@/ui/State";
import { pressFeedback } from "@/ui/press";

const HERE = "/debt";

/**
 * How fast can you be debt-free (/debt, debt.tsx on the web): the debt on the
 * plan with its composition, the page's actions, the plan's figures, the plan
 * itself (the extra each month, then the order, each row what to send that
 * debt and opening its account), and the cards kept off the plan (no rate on
 * file, or cleared every month). Self-directed: no nav bar verb.
 */
export default function DebtScreen() {
  const t = useTheme();
  const hidden = useAmountsHidden();
  const debts = useQuery({ queryKey: ["debts"], queryFn: debtApi.list });
  const balances = useQuery({ queryKey: ["accounts", "balances"], queryFn: homeApi.balances });
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  const verbs = useActionVerbs();
  const page = useMemo(() => (debts.data ? toDebtPage(debts.data) : null), [debts.data]);
  const actions = useMemo(() => pageActions(insights.data?.insights ?? [], ["debt"]), [insights.data]);
  const doneHere = verbs.done.filter((r) => r.type === "debt");

  // Null until the user types: the field then shows the suggested extra.
  const [extraText, setExtraText] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([debts.refetch(), balances.refetch(), insights.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  const actionsGroup =
    actions.length > 0 || doneHere.length > 0 ? (
      <ActionGroup title="Actions" rows={actions} done={doneHere} here={HERE} onComplete={verbs.complete} onSnooze={verbs.snooze} onDismiss={verbs.dismiss} />
    ) : null;

  const body = (() => {
    if (debts.isPending || (balances.isPending && !page)) {
      return (
        <>
          <CardSkeleton lines={6} />
          <CardSkeleton lines={4} />
          <CardSkeleton lines={5} />
        </>
      );
    }
    // A failed refresh keeps what is on screen: only a first load that failed shows the error.
    if (!page) {
      return <ErrorState title="Couldn't load your debt" error={debts.error} onRetry={() => void debts.refetch()} />;
    }
    if ((balances.data?.balances.length ?? 0) === 0) {
      return (
        <EmptyState
          icon="creditcard"
          title="No accounts linked"
          body="Add your credit cards and loans to see your debt, your payoff date and the order to pay it in."
          action={{ title: "Add an account", onPress: () => openAddAccount() }}
        />
      );
    }
    if (page.debtOnPlan > 0) return <PlanView page={page} hidden={hidden} actions={actionsGroup} extraText={extraText} onExtra={setExtraText} strategy={strategy} onStrategy={setStrategy} />;
    if (page.clears.length > 0 || page.needsRate.length > 0) {
      return (
        <>
          <Text style={[styles.lead, { color: t.contentSecondary }]}>{page.needsRate.length > 0 ? "No payoff plan yet." : "No debt to pay down."}</Text>
          <NeedsRate cards={page.needsRate} hidden={hidden} />
          <ClearsMonthly cards={page.clears} hidden={hidden} />
          {actionsGroup}
        </>
      );
    }
    return (
      <>
        <Card hero="income" style={{ gap: 6 }}>
          <CardHeader title="You're debt-free" />
          <Text style={[styles.lead, { color: t.contentSecondary, paddingHorizontal: 0 }]}>Redirect those payments into investments and savings.</Text>
        </Card>
        {actionsGroup}
      </>
    );
  })();

  return (
    <ScreenScroll title="Debt" refreshing={pulling} onRefresh={() => void onPull()} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      {body}
    </ScreenScroll>
  );
}

function PlanView({
  page,
  hidden,
  actions,
  extraText,
  onExtra,
  strategy,
  onStrategy,
}: {
  page: ReturnType<typeof toDebtPage>;
  hidden: boolean;
  actions: React.ReactNode;
  extraText: string | null;
  onExtra: (v: string) => void;
  strategy: PayoffStrategy;
  onStrategy: (s: PayoffStrategy) => void;
}) {
  const t = useTheme();
  const d = useDesign();
  const spendInk = d.color.tint.spend.ink;
  // Under the ranked skin (Noodle), one sauce ramp tells the debts apart, darkest first, as the web does: a second hue
  // would claim a meaning (yellow is attention). Classic keeps its chart palette.
  const spend = d.color.tint.spend;
  const debtRamp = d.skin.breakdown === "ranked" ? [1, 0.78, 0.58, 0.42, 0.3, 0.2].map((a) => composite(withAlpha(spend.accent, a), spend.fill)) : undefined;
  const stacked = useWindowDimensions().fontScale > 1.3;
  const debts = page.payoff;
  const suggested = startingExtra(page);
  const extraValue = extraText ?? (suggested > 0 ? String(suggested) : "");
  const extra = parseExtra(extraValue);
  const invalid = extraInvalid(extraValue);
  const p = buildPlan(debts, extra, strategy);
  const clears = Number.isFinite(p.plan.months);
  const assumed = debts.filter((x) => x.aprAssumed);
  const highest = debts[0];
  const hint = invalid ? null : extraHint(p, extra);
  const statement = p.comparison.tie ? orderStatement(debts, extra, clears) : null;
  const notes = strategyNotes(p.comparison);
  const chosen = p.comparison[p.strategy];
  const chosenNote = [notes.cheaper === p.strategy ? "Lowest cost." : null, notes.firstClose === p.strategy ? "Closes an account soonest." : null].filter(Boolean).join(" ");
  const amount = formatMoney(page.debtOnPlan, true);

  // Every cell is a label and a value, so the grid lines up. The assumed rate is stated in the hero and the plan.
  const stats: Array<{ label: string; value: string; neg?: boolean }> = [
    { label: "Blended APR", value: `${blendedApr(debts)}%` },
    ...(extra > 0 ? [{ label: "Monthly payment", value: formatMoney(p.monthlyPayment, true) }] : []),
    { label: "Minimum due", value: formatMoney(p.totalMinPayment, true) },
    ...(highest ? [{ label: `Highest rate, ${debtTypeLabel(highest).toLowerCase()}${highest.aprAssumed ? " (assumed)" : ""}`, value: `${highest.apr}%`, neg: isHighRate(highest) }] : []),
  ];

  return (
    <>
      {/* 1. Hero: the debt on the plan, the one sentence that answers the page, and what it is made of. */}
      <Card hero="spend" style={{ gap: 14 }}>
        <View style={{ gap: 2 }}>
          <Text style={[styles.caption, { color: spendInk }]}>{page.notInPlan.count > 0 ? "Debt in your payoff plan" : "Total debt"}</Text>
          <HeroAmount label={`${page.notInPlan.count > 0 ? "Debt in your payoff plan" : "Total debt"}, ${amount}`}>
            <Text style={[styles.hero, { color: hidden ? t.content : t.negative }]} numberOfLines={1} adjustsFontSizeToFit>{amount}</Text>
          </HeroAmount>
          {page.notInPlan.count > 0 ? (
            <Text style={[styles.sub, { color: t.contentMuted }]}>{`${formatMoney(page.notInPlan.amount, true)} on ${page.notInPlan.count} card${page.notInPlan.count === 1 ? "" : "s"} is not in the plan`}</Text>
          ) : null}
          <Text style={[styles.sub, { color: t.contentMuted }]}>{debtFacts(page).join(", ")}</Text>
        </View>
        <View style={{ gap: 4 }}>
          <Text style={[styles.sentence, { color: t.contentSecondary }]}>{heroSentence(p, extra)}</Text>
          {assumed.length > 0 ? (
            <Text style={[styles.sub, { color: t.contentMuted }]}>
              {assumed.length === 1 ? `Includes an assumed ${assumed[0].apr}% rate on ${debtName(assumed[0])}.` : `Includes assumed rates on ${assumed.length} debts.`}
            </Text>
          ) : null}
        </View>
        <Allocation
          label="Debt by balance"
          hidden={hidden}
          wholePct
          ramp={debtRamp}
          rows={debtSegments(debts).map((s) => ({ key: s.key, label: s.label, value: s.value, pct: s.pct, chart: s.chart, owed: true }))}
        />
      </Card>

      {/* 2. The page's actions. */}
      {actions}

      {/* 3. The plan's figures. */}
      <Card style={styles.grid}>
        {stats.map((s) => (
          <View key={s.label} style={[styles.stat, stacked ? styles.statFull : null]} accessible accessibilityLabel={`${s.label}, ${s.value}`}>
            <Text style={[styles.statLabel, { color: t.contentMuted }]} numberOfLines={2}>
              {s.label}
            </Text>
            <Text style={[styles.statValue, { color: s.neg && !hidden ? t.negative : t.content }]} numberOfLines={1} adjustsFontSizeToFit>
              {s.value}
            </Text>
          </View>
        ))}
      </Card>

      {/* 4. The plan: the lever, what it does, the order, and what to send each debt. */}
      <Card style={{ gap: 12 }}>
        <CardHeader title="Your payoff plan" />
        {assumed.length > 0 ? <Text style={[styles.sub, { color: t.contentMuted }]}>These dates and interest totals include an assumed rate.</Text> : null}
        <Card nested style={invalid ? { borderWidth: 1, borderColor: t.negative } : null}>
          <InputRow label="Extra each month" value={extraValue} onChange={onExtra} placeholder="$0" keyboardType="decimal-pad" money />
        </Card>
        {invalid ? (
          <Text style={[styles.sub, { color: t.negative }]}>Enter an amount of $0 or more.</Text>
        ) : hint ? (
          <Text style={[styles.sub, { color: t.contentSecondary }]}>{hint}</Text>
        ) : null}
        <View style={styles.dates} accessibilityLiveRegion="polite">
          <View style={{ flex: 1 }}>
            <Text style={[styles.statLabel, { color: t.contentMuted }]}>Debt-free</Text>
            <Text style={[styles.date, { color: t.content }]}>{addMonths(p.plan.months)}</Text>
            {extra === 0 ? <Text style={[styles.statSub, { color: t.contentMuted }]}>Same as paying only the minimums</Text> : null}
          </View>
          {extra > 0 && p.plan.months !== p.minimums.months ? (
            <View style={{ flex: 1 }}>
              <Text style={[styles.statLabel, { color: t.contentMuted }]}>At minimums</Text>
              <Text style={[styles.date, { color: t.contentMuted }]}>{addMonths(p.minimums.months)}</Text>
            </View>
          ) : null}
        </View>

        {statement ? <Text style={[styles.sentence, { color: t.contentSecondary }]}>{statement}</Text> : null}
        {!p.comparison.tie ? (
          <View style={{ gap: 8 }}>
            <ScopePills<PayoffStrategy> accessibilityLabel="Payoff order" value={p.strategy} onChange={onStrategy} options={STRATEGIES.map((s) => ({ value: s.value, label: s.title }))} />
            <Text style={[styles.sub, { color: t.contentSecondary }]}>
              {`${chosenNote ? `${chosenNote} ` : ""}Debt-free ${addMonths(chosen.months)}${Number.isFinite(chosen.totalInterest) ? `, ${formatMoney(Math.round(chosen.totalInterest), true)} in interest` : ""}.`}
            </Text>
            <View style={{ alignSelf: "flex-start" }}>
              <TextLink title="Which order should I pick?" onPress={() => openChat("Should I pay my highest-rate debt first or my smallest balance first?")} />
            </View>
          </View>
        ) : null}

        <Text style={[styles.subhead, { color: t.content }]} accessibilityRole="header">
          {p.ranked ? "Pay in this order" : debts.length === 1 ? "Your payment" : "Your payments"}
        </Text>
        <View style={{ marginHorizontal: -space.card }}>
          {p.ordered.map((x, i) => (
            <Fragment key={x.id}>
              {i > 0 ? <Divider inset={space.card} /> : null}
              <OrderRow d={x} rank={p.ranked ? i + 1 : null} hidden={hidden} meta={`${paymentLine(x, i === 0, extra)}, payoff ${payoffMonth(x, p)}`} />
            </Fragment>
          ))}
        </View>
        {/* The payments and charges behind these balances. */}
        <View style={styles.seeTxns}>
          <TextLink
            title="See transactions"
            label={`See transactions for ${debts.length === 1 ? "this debt" : `these ${debts.length} debts`}`}
            onPress={() => openPath(transactionsHref({ accountIds: p.ordered.map((x) => x.id) }))}
          />
        </View>
      </Card>

      <NeedsRate cards={page.needsRate} hidden={hidden} />

      <ClearsMonthly cards={page.clears} hidden={hidden} />
    </>
  );
}

/**
 * One debt in the plan's order: its rank (the first lit), the name with its
 * rate, what to send it and when it is paid off, the balance. The row opens
 * the account, and an assumed rate asks for the real one. Large text stacks
 * the name, the rate and the balance so none of them is cut.
 */
function OrderRow({ d, rank, hidden, meta }: { d: DebtAccount; rank: number | null; hidden: boolean; meta: string }) {
  const t = useTheme();
  const stacked = useWindowDimensions().fontScale > 1.3;
  const name = debtName(d);
  const amount = formatMoney(d.balance, true);
  const lead = rank === 1;
  const amountEl = <Text style={[styles.rowAmount, { color: hidden ? t.content : t.negative }]}>{amount}</Text>;
  return (
    <View>
      <Pressable
        onPress={() => openPath(`/accounts/${d.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${rank ? `${rank}. ` : ""}${name}, ${d.apr}%${d.aprAssumed ? " assumed" : ""}, ${amount} owed, ${meta}`}
        accessibilityHint="Opens the account"
        // The debt to pay next wears basil: a current-item marker, meaningful color (owner, 2026-11-23).
        style={({ pressed }) => [styles.orderRow, lead && { backgroundColor: t.brandSofter }, pressed && { backgroundColor: t.faintFill }]}
      >
        {rank ? (
          <View style={[styles.ordinal, { backgroundColor: lead ? t.brandInk : t.faintFill }]}>
            <Text style={[styles.ordinalText, { color: lead ? t.brandFg : t.contentSecondary }]} maxFontSizeMultiplier={1.4}>
              {rank}
            </Text>
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={[styles.nameLine, stacked && styles.nameLineStacked]}>
            <Text style={[styles.rowName, { color: t.content }]} numberOfLines={stacked ? 3 : 1}>
              {name}
            </Text>
            <RateTag d={d} stacked={stacked} />
          </View>
          <Text style={[styles.rowMeta, { color: t.contentMuted }]}>{meta}</Text>
          {stacked ? amountEl : null}
        </View>
        {stacked ? null : amountEl}
        <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
      {d.aprAssumed ? (
        <View style={[styles.rowAction, { paddingLeft: rank ? space.card + 28 + 12 : space.card }]}>
          <Button size="compact" variant="secondary" title="Add rate" accessibilityLabel={`Add rate for ${name}`} onPress={() => openAccountEdit(d.id)} />
        </View>
      ) : null}
    </View>
  );
}

/** The rate beside a debt's name: red above 20% on file, caution when assumed. */
function RateTag({ d, stacked }: { d: DebtAccount; stacked?: boolean }) {
  const t = useTheme();
  const tone = d.aprAssumed ? { bg: t.cautionSoft, fg: t.caution } : isHighRate(d) ? { bg: t.negativeSoft, fg: t.negative } : { bg: t.faintFill, fg: t.contentSecondary };
  return (
    <View style={[styles.tag, stacked && { marginLeft: 0 }, { backgroundColor: tone.bg }]}>
      <Text style={[styles.tagText, { color: tone.fg }]} maxFontSizeMultiplier={1.4}>{`${d.apr}%`}</Text>
    </View>
  );
}

/**
 * One debt account: its type's tile, the name and a line about it, the
 * balance, and a way on: the account's page, or Add rate when the rate is
 * assumed (the Edit account sheet, where the rate lives).
 */
function DebtRow({ d, hidden, meta, owed = true }: { d: DebtAccount; hidden: boolean; meta: string; owed?: boolean }) {
  const t = useTheme();
  const stacked = useWindowDimensions().fontScale > 1.3;
  const name = debtName(d);
  const amount = formatMoney(d.balance, true);
  const type = `${debtTypeLabel(d)}${d.property ? ` on ${d.property.name}` : ""}`;
  return (
    <View style={styles.debtRow}>
      <Pressable
        onPress={() => openPath(`/accounts/${d.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${amount}${owed ? " owed" : ""}, ${type}, ${meta}`}
        accessibilityHint="Opens the account"
        style={({ pressed }) => [styles.debtMain, pressFeedback(t, pressed)]}
      >
        <CategoryMedallion role={accountTypeRole(d.type)} display={{ label: d.type, symbol: accountTypeSymbol(d.type, d.subtype), emoji: null }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.rowName, { color: t.content }]} numberOfLines={stacked ? 3 : 1}>
            {name}
          </Text>
          <Text style={[styles.rowMeta, { color: t.contentMuted }]} numberOfLines={stacked ? 3 : 1}>
            {type}
          </Text>
          <Text style={[styles.rowMeta, { color: t.contentMuted }]}>{meta}</Text>
          {stacked ? <Text style={[styles.rowAmount, { color: owed && !hidden ? t.negative : t.content }]}>{amount}</Text> : null}
        </View>
        {stacked ? null : <Text style={[styles.rowAmount, { color: owed && !hidden ? t.negative : t.content }]}>{amount}</Text>}
        <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
      </Pressable>
      {d.aprAssumed || d.planRole === "needs-rate" ? (
        <View style={styles.rowAction}>
          <Button size="compact" variant="secondary" title="Add rate" accessibilityLabel={`Add rate for ${name}`} onPress={() => openAccountEdit(d.id)} />
        </View>
      ) : null}
    </View>
  );
}

/** Cards with no rate on file: off the plan until the rate is added. */
function NeedsRate({ cards, hidden }: { cards: DebtAccount[]; hidden: boolean }) {
  const t = useTheme();
  if (cards.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader trailing={cards.length > 1 ? { text: `${cards.length} cards`, color: t.contentMuted } : undefined}>Rate not on file</SectionHeader>
      <Text style={[styles.lead, { color: t.contentMuted }]}>
        {cards.length === 1
          ? "We do not know what this card charges, so it is not in your payoff plan. Add the rate to see where it belongs."
          : "We do not know what these cards charge, so they are not in your payoff plan. Add the rate to see where each one belongs."}
      </Text>
      <Card style={styles.listCard}>
        {cards.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <Divider /> : null}
            <DebtRow d={c} hidden={hidden} owed={false} meta="Rate not on file" />
          </Fragment>
        ))}
      </Card>
    </View>
  );
}

/** Cards cleared in full each month: this month's spending, not debt to pay down. */
function ClearsMonthly({ cards, hidden }: { cards: DebtAccount[]; hidden: boolean }) {
  const t = useTheme();
  if (cards.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader trailing={cards.length > 1 ? { text: `${cards.length} cards`, color: t.contentMuted } : undefined}>Clears every month</SectionHeader>
      <Text style={[styles.lead, { color: t.contentMuted }]}>{cards.length === 1 ? "This card costs no interest." : "These cost no interest."}</Text>
      <Card style={styles.listCard}>
        {cards.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <Divider /> : null}
            <DebtRow d={c} hidden={hidden} owed={false} meta="Paid in full each month" />
          </Fragment>
        ))}
      </Card>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    seeTxns: { alignItems: "flex-start", paddingTop: 4 },
    caption: { ...type.subhead, ...weight.semibold },
    hero: { ...type.amountXL },
    sub: { ...type.footnote },
    sentence: { ...type.callout },
    lead: { ...type.subhead, paddingHorizontal: space.card },
    grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 16, columnGap: 12 },
    stat: { width: "47%", gap: 2 },
    statFull: { width: "100%" },
    statLabel: { ...type.footnote, ...weight.semibold },
    statValue: { ...type.amountM },
    statSub: { ...type.caption },
    dates: { flexDirection: "row", gap: 12 },
    date: { ...type.headline, ...figures },
    subhead: { ...type.headline, marginTop: 4 },
    section: { gap: 8 },
    listCard: { padding: 0 },
    orderRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.card, paddingVertical: 12, minHeight: 60 },
    ordinal: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    ordinalText: { ...type.footnote, ...figures },
    nameLine: { flexDirection: "row", alignItems: "center", gap: 0, flexWrap: "nowrap" },
    nameLineStacked: { flexDirection: "column", alignItems: "flex-start", gap: 4 },
    rowName: { ...type.callout, ...weight.semibold, flexShrink: 1 },
    rowMeta: { ...type.footnote },
    rowAmount: { ...type.amountM },
    tag: { marginLeft: 8, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 0 },
    tagText: { ...type.caption, ...weight.bold, ...figures },
    debtRow: { paddingBottom: 0 },
    debtMain: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 12, minHeight: 64 },
    rowAction: { paddingLeft: space.rowInset + 42 + 12, paddingRight: space.rowInset, paddingBottom: 12, alignItems: "flex-start" },
  }),
);
