import * as Haptics from "expo-haptics";
import { StyleSheet, Text, View } from "react-native";
import { DateRow, InputRow } from "@/components/accounts/FormFields";
import { formatMoney } from "@/lib/format";
import { decimal2, digits, monthlyPace, paceText, type DetailDraft, type DraftField, type GoalFormContext, type ResolvedDraft, type TypedGoalCategory } from "@/lib/goal-form";
import { pickerGroups, pickerTotalLine, type GoalBalance } from "@/lib/goals";
import { figures, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { CheckRow, Divider, formStyles, Group, SectionHeader, Segmented } from "@/ui/Form";
import { Skeleton } from "@/ui/Skeleton";

// The goal sheets' fields (goal-details.tsx GoalDetailFields, GoalTargetReadout,
// NoSpendData and goal-shared.tsx AccountPicker), on the grouped-form primitives.

/** A group's field errors, in the group's own order, under it. */
export function FieldErrors({ messages }: { messages: Array<string | undefined> }) {
  const t = useTheme();
  const shown = messages.filter(Boolean) as string[];
  if (shown.length === 0) return null;
  return (
    <View accessibilityLiveRegion="polite">
      {shown.map((m) => (
        <Text key={m} style={[formStyles.footnote, { color: t.negative }]}>
          {m}
        </Text>
      ))}
    </View>
  );
}

const pick = (fn: () => void) => {
  Haptics.selectionAsync();
  fn();
};

/** The typed kind's own fields: the thing being saved for, then when it is wanted by. */
export function TypedFields({
  kind,
  draft,
  onChange,
  resolved,
  ctx,
  savedByAge,
}: {
  kind: TypedGoalCategory;
  draft: DetailDraft;
  onChange: (patch: Partial<DetailDraft>) => void;
  resolved: ResolvedDraft;
  ctx: GoalFormContext;
  /** Already saved by an age: the age stays on offer without a birth date. */
  savedByAge: boolean;
}) {
  const t = useTheme();
  const err = resolved.errors;
  const money = (f: DraftField) => (v: string) => onChange({ [f]: decimal2(v) } as Partial<DetailDraft>);
  const count = (f: DraftField) => (v: string) => onChange({ [f]: digits(v) } as Partial<DetailDraft>);
  // "By age" lands on a date only with a birth date, so without one the date stands alone.
  const canUseAge = !!ctx.dateOfBirth || savedByAge;
  const byAge = draft.dateMode === "age";

  const reachBy = (
    <View style={formStyles.section}>
      <SectionHeader>Reach it by</SectionHeader>
      {canUseAge ? (
        <Segmented<"age" | "date">
          accessibilityLabel="Reach it by"
          value={draft.dateMode}
          onChange={(dateMode) => pick(() => onChange({ dateMode }))}
          options={[
            { value: "age", label: "Age" },
            { value: "date", label: "Date" },
          ]}
        />
      ) : null}
      <Group>
        {canUseAge && byAge ? (
          <InputRow label="Age you want it by" value={draft.byAge} onChange={count("byAge")} keyboardType="number-pad" placeholder="35" />
        ) : (
          <DateRow label="Target date" value={draft.byDate} onChange={(byDate) => onChange({ byDate })} />
        )}
      </Group>
      <FieldErrors messages={[canUseAge && byAge ? err.byAge : err.byDate]} />
    </View>
  );

  switch (kind) {
    case "home_purchase":
      return (
        <>
          <View style={formStyles.section}>
            <SectionHeader>The home</SectionHeader>
            <Group>
              <InputRow label="Home price" value={draft.homePrice} onChange={money("homePrice")} money keyboardType="decimal-pad" placeholder="450,000" />
              <Divider />
              <InputRow label="Down payment (%)" value={draft.downPaymentPct} onChange={money("downPaymentPct")} keyboardType="decimal-pad" placeholder="20" />
            </Group>
            <FieldErrors messages={[err.homePrice, err.downPaymentPct]} />
          </View>
          <View style={formStyles.section}>
            <SectionHeader>Closing costs</SectionHeader>
            <Segmented<"yes" | "no">
              accessibilityLabel="Closing costs"
              value={draft.includeClosingCosts ? "yes" : "no"}
              onChange={(v) => pick(() => onChange({ includeClosingCosts: v === "yes" }))}
              options={[
                { value: "yes", label: "Include" },
                { value: "no", label: "Skip" },
              ]}
            />
            {draft.includeClosingCosts ? (
              <Group>
                <InputRow label="Closing costs (%)" value={draft.closingCostPct} onChange={money("closingCostPct")} keyboardType="decimal-pad" placeholder="3" />
              </Group>
            ) : null}
            <FieldErrors messages={[draft.includeClosingCosts ? err.closingCostPct : undefined]} />
          </View>
          {reachBy}
        </>
      );
    case "car":
      return (
        <>
          <View style={formStyles.section}>
            <SectionHeader>The vehicle</SectionHeader>
            <Group>
              <InputRow label="Vehicle price" value={draft.vehiclePrice} onChange={money("vehiclePrice")} money keyboardType="decimal-pad" placeholder="32,000" />
            </Group>
            <FieldErrors messages={[err.vehiclePrice]} />
          </View>
          <View style={formStyles.section}>
            <SectionHeader>Paying</SectionHeader>
            <Segmented<"down" | "cash">
              accessibilityLabel="Paying"
              value={draft.carPayCash ? "cash" : "down"}
              onChange={(v) => pick(() => onChange({ carPayCash: v === "cash" }))}
              options={[
                { value: "down", label: "Down payment" },
                { value: "cash", label: "Cash" },
              ]}
            />
            {draft.carPayCash ? null : (
              <Group>
                <InputRow label="Down payment (%)" value={draft.carDownPaymentPct} onChange={money("carDownPaymentPct")} keyboardType="decimal-pad" placeholder="20" />
              </Group>
            )}
            <FieldErrors messages={[draft.carPayCash ? undefined : err.carDownPaymentPct]} />
          </View>
          {reachBy}
        </>
      );
    case "education":
      return (
        <View style={formStyles.section}>
          <SectionHeader>The schooling</SectionHeader>
          <Group>
            <InputRow label="Yearly cost" value={draft.annualCost} onChange={money("annualCost")} money keyboardType="decimal-pad" placeholder="30,000" />
            <Divider />
            <InputRow label="Number of years" value={draft.years} onChange={count("years")} keyboardType="number-pad" placeholder="4" />
            <Divider />
            <InputRow label="Year it starts" value={draft.startYear} onChange={count("startYear")} keyboardType="number-pad" placeholder={String(new Date().getFullYear() + 5)} />
          </Group>
          <FieldErrors messages={[err.annualCost, err.years, err.startYear]} />
        </View>
      );
    case "retirement":
      return (
        <View style={formStyles.section}>
          <SectionHeader>Retirement</SectionHeader>
          <Group>
            <InputRow label="Yearly income" value={draft.targetAnnualIncome} onChange={money("targetAnnualIncome")} money keyboardType="decimal-pad" placeholder="80,000" />
            {canUseAge ? (
              <>
                <Divider />
                <InputRow label="Retirement age" value={draft.targetAge} onChange={count("targetAge")} keyboardType="number-pad" placeholder="62" />
              </>
            ) : null}
          </Group>
          <FieldErrors messages={[err.targetAnnualIncome, err.targetAge]} />
          {!canUseAge ? (
            <Text style={[formStyles.footnote, { color: t.contentMuted }]}>Add your date of birth in Settings to see a target date and a monthly pace.</Text>
          ) : ctx.retirementAge != null && draft.targetAge === String(ctx.retirementAge) ? (
            <Text style={[formStyles.footnote, { color: t.contentMuted }]}>From your retirement plan in Settings. Changing it here only changes this goal.</Text>
          ) : null}
        </View>
      );
    case "emergency_fund":
      return (
        <View style={formStyles.section}>
          <SectionHeader>The cushion</SectionHeader>
          <Group>
            <InputRow label="Months of expenses" value={draft.months} onChange={count("months")} keyboardType="number-pad" placeholder="6" />
          </Group>
          <FieldErrors messages={[err.months]} />
        </View>
      );
  }
}

/**
 * The target the fields add up to. Incomplete fields never show a number: the
 * slot says what is missing instead. With a date, the monthly amount that gets
 * there, which can become the goal's plan.
 */
export function TargetReadout({ resolved, saved = 0, onUseMonthlyPlan }: { resolved: ResolvedDraft; saved?: number; onUseMonthlyPlan: (amount: number) => void }) {
  const t = useTheme();
  const pace = resolved.target !== null ? monthlyPace(resolved.target, saved, resolved.deadline) : null;
  const showPace = !resolved.pending && resolved.target !== null && !resolved.dateNeeded && pace;
  return (
    <Card nested style={[styles.readout, { backgroundColor: t.canvasSunken }]}>
      <Text style={[styles.readoutLabel, { color: t.contentSecondary }]}>Target amount</Text>
      <View accessibilityLiveRegion="polite">
        {resolved.pending ? (
          <Skeleton width={160} height={30} />
        ) : resolved.target === null ? (
          resolved.prompt ? <Text style={[styles.prompt, { color: t.contentMuted }]}>{resolved.prompt}</Text> : null
        ) : (
          <>
            <Text style={[styles.readoutFigure, { color: t.content }]}>{formatMoney(resolved.target, true)}</Text>
            {resolved.derivation ? <Text style={[styles.readoutLine, { color: t.contentMuted }]}>{resolved.derivation}</Text> : null}
            {resolved.dateNeeded ? <Text style={[styles.readoutNeed, { color: t.contentSecondary }]}>{resolved.dateNeeded}</Text> : null}
          </>
        )}
      </View>
      {showPace && pace ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Text style={[styles.readoutNeed, { color: t.contentSecondary }]}>{paceText(pace)}</Text>
          <Button size="compact" variant="secondary" title="Use as my monthly plan" onPress={() => onUseMonthlyPlan(pace.amount)} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : null}
    </Card>
  );
}

/** An emergency fund with no spending to price months against. */
export function NoSpendData({ onSetPlainTarget }: { onSetPlainTarget: () => void }) {
  const t = useTheme();
  return (
    <Card nested style={[styles.readout, { backgroundColor: t.canvasSunken }]}>
      <Text style={[styles.prompt, { color: t.contentSecondary }]}>We do not have enough categorized spending yet to price this in months. Enter a target amount instead.</Text>
      <Button size="compact" variant="secondary" title="Set a target amount" onPress={onSetPlainTarget} style={{ alignSelf: "flex-start", marginTop: 4 }} />
    </Card>
  );
}

/**
 * The accounts behind a goal: grouped by type with the kind's usual type
 * first, a check on the picked ones, and what they hold against the target.
 */
export function AccountPicker({
  accounts,
  selected,
  onToggle,
  preferType,
  pinned,
  target,
}: {
  accounts: GoalBalance[];
  selected: string[];
  onToggle: (id: string) => void;
  preferType: string;
  pinned: ReadonlySet<string>;
  target: number | null | undefined;
}) {
  const t = useTheme();
  const groups = pickerGroups(accounts, preferType, pinned);
  const total = pickerTotalLine(accounts, selected, target);
  return (
    <>
      {groups.map((g) => (
        <View key={g.type} style={{ gap: 6 }}>
          {groups.length > 1 ? <SectionHeader>{g.title}</SectionHeader> : null}
          <Group>
            {g.rows.map((a, i) => (
              <View key={a.accountId}>
                {i > 0 ? <Divider /> : null}
                <CheckRow
                  label={a.name}
                  value={formatMoney(parseFloat(a.balance ?? "0"), true)}
                  detail={a.mask ? `••${a.mask}` : undefined}
                  checked={selected.includes(a.accountId)}
                  onPress={() => pick(() => onToggle(a.accountId))}
                />
              </View>
            ))}
          </Group>
        </View>
      ))}
      <View accessibilityLiveRegion="polite">{total ? <Text style={[formStyles.footnote, styles.total, { color: t.contentSecondary }]}>{total}</Text> : null}</View>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    readout: { padding: 16, gap: 4 },
    readoutLabel: { ...type.footnote, ...weight.medium },
    readoutFigure: { ...type.amountL, ...figures },
    readoutLine: { ...type.footnote },
    readoutNeed: { ...type.footnote, ...weight.semibold },
    prompt: { ...type.subhead },
    total: { fontVariant: ["tabular-nums"] },
  }),
);
