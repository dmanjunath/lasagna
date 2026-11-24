import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { saveErrorText } from "@/api/client";
import { goalsApi, invalidateGoals, useBalances, useGoals, type GoalWrite } from "@/api/goals";
import { DateRow, InputRow } from "@/components/accounts/FormFields";
import { goalColor, GoalTile } from "@/components/goals/GoalParts";
import { AccountPicker, FieldErrors, NoSpendData, TargetReadout, TypedFields } from "@/components/goals/GoalFields";
import {
  CALCULATE_LABELS,
  EMPTY_CONTEXT,
  decimal2,
  detailsAge,
  draftFromDetails,
  emptyDraft,
  isTypedGoalCategory,
  plainFieldErrors,
  resolveDraft,
  type DetailDraft,
  type GoalFormContext,
  type TypedGoalCategory,
} from "@/lib/goal-form";
import { markGoalDeleted } from "@/lib/goal-sheets";
import { fundableAccounts, GOAL_PRESETS, preferredAccountType, presetFor, type Goal, type GoalPreset } from "@/lib/goals";
import { openPath } from "@/lib/navigation";
import { markWebStale } from "@/lib/web-stale";
import { space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card, TextLink } from "@/ui/Card";
import { committed, failed } from "@/ui/feedback";
import { Divider, formStyles, Group, SectionHeader, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { EmptyState } from "@/ui/State";
import { showToast } from "@/ui/Toast";
import { pressFeedback } from "@/ui/press";

type Focus = "monthly" | "accounts" | "date";

/**
 * New goal (goal-new.tsx) and Edit goal (savings-goal.tsx's edit panel, its
 * accounts editor and its Delete) as one sheet. New starts on the kind grid,
 * or on the fields for `kind` (a Suggested row). A typed kind describes the
 * thing and the target is worked out live, as the API will store it.
 */
export default function GoalFormSheet({ id, kind, focus }: { id?: string; kind?: string; focus?: Focus }) {
  const goals = useGoals();
  if (!id) return <Editor initialKind={presetFor(kind) ? kind! : null} />;
  if (goals.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  const goal = goals.data?.goals.find((g) => g.id === id);
  if (!goal) return <EmptyState gutter art={false} title="This goal isn't available" body="It may have been deleted." action={{ title: "Close", onPress: () => router.back() }} />;
  return <Editor key={id} goal={goal} focus={focus} />;
}

/** The birth date, retirement age and monthly spend the typed fields need, fetched once a form is open. */
function useGoalFormContext(): GoalFormContext {
  const q = useQuery({
    queryKey: ["goal-form-context"],
    queryFn: async (): Promise<GoalFormContext> => {
      const [profile, spend] = await Promise.all([
        goalsApi.financialProfile().catch(() => ({ financialProfile: null })),
        goalsApi.spendBaseline().catch(() => ({ monthlySpend: null, windowMonths: 3 })),
      ]);
      return {
        dateOfBirth: profile.financialProfile?.dateOfBirth ?? null,
        currentAge: profile.financialProfile?.age ?? null,
        retirementAge: profile.financialProfile?.retirementAge ?? null,
        monthlySpend: spend.monthlySpend,
        loaded: true,
      };
    },
  });
  return q.data ?? EMPTY_CONTEXT;
}

function Editor({ goal, initialKind, focus }: { goal?: Goal; initialKind?: string | null; focus?: Focus }) {
  const t = useTheme();
  const qc = useQueryClient();
  const editing = !!goal;
  const ctx = useGoalFormContext();
  const balances = useBalances();
  // Large text: one kind per line, so no name breaks inside a word.
  const oneColumn = useWindowDimensions().fontScale > 1.3;
  const fundable = useMemo(() => fundableAccounts(balances.data?.balances ?? []), [balances.data]);

  const startPreset = initialKind ? presetFor(initialKind) : undefined;
  const [page, setPage] = useState<"kind" | "form">(editing || startPreset ? "form" : "kind");
  const openedOnForm = editing || !!startPreset;

  // The form, as the web keeps it: plain fields, one draft per typed kind, and the plain-target opt-outs.
  const [initial] = useState(() => ({
    name: goal?.name ?? startPreset?.name ?? "",
    category: goal?.category ?? startPreset?.category ?? "savings",
    icon: goal?.icon ?? startPreset?.icon ?? "target",
    target: goal ? String(parseFloat(goal.targetAmount)) : "",
    deadline: goal?.deadline ? goal.deadline.slice(0, 10) : "",
    monthly: goal?.monthlyContribution ? String(parseFloat(goal.monthlyContribution)) : "",
    current: goal ? String(parseFloat(goal.currentAmount)) : "",
    accountIds: goal?.accountIds ?? [],
  }));
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState(initial.category);
  const [iconKey, setIconKey] = useState(initial.icon);
  const [target, setTarget] = useState(initial.target);
  const [deadline, setDeadline] = useState(initial.deadline);
  const [monthly, setMonthly] = useState(initial.monthly);
  const [current, setCurrent] = useState(initial.current);
  const [accountIds, setAccountIds] = useState<string[]>(initial.accountIds);
  const [pinned] = useState(() => new Set(initial.accountIds));
  const [drafts, setDrafts] = useState<Partial<Record<TypedGoalCategory, DetailDraft>>>({});
  // New: kinds given a plain target instead. Edit: whether the goal describes itself (a goal saved before that opts in).
  const [plainKinds, setPlainKinds] = useState<string[]>([]);
  const [useDetails, setUseDetails] = useState(goal ? goal.details !== null : true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = isTypedGoalCategory(category);
  const kind: TypedGoalCategory | null = typed && (editing ? useDetails : !plainKinds.includes(category)) ? (category as TypedGoalCategory) : null;
  const savedDetails = goal?.details && kind && goal.details.kind === kind ? goal.details : null;
  const draft: DetailDraft | null = kind ? drafts[kind] ?? (savedDetails ? draftFromDetails(savedDetails, ctx) : emptyDraft(kind, ctx)) : null;
  const savedAge = detailsAge(goal?.details);
  const resolved =
    kind && draft
      ? resolveDraft(
          kind,
          draft,
          ctx,
          goal
            ? { monthlySpend: goal.details?.kind === "emergency_fund" ? goal.details.monthlySpendUsed : null, deadline: goal.deadline ? goal.deadline.slice(0, 10) : null, age: savedAge }
            : undefined,
        )
      : null;

  // A draft started before the profile landed keeps no stale defaults: only untouched fields catch up.
  useEffect(() => {
    if (!ctx.loaded) return;
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(prev) as TypedGoalCategory[]) {
        const cur = prev[key];
        if (!cur) continue;
        const seed = emptyDraft(key, ctx);
        const patch: Partial<DetailDraft> = {};
        if (cur.targetAge === "" && seed.targetAge !== "") patch.targetAge = seed.targetAge;
        if (cur.byAge === "" && cur.byDate === "" && cur.dateMode !== seed.dateMode) patch.dateMode = seed.dateMode;
        if (Object.keys(patch).length > 0) {
          next[key] = { ...cur, ...patch };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [ctx]);

  const patchDraft = (patch: Partial<DetailDraft>) => {
    if (!kind || !draft) return;
    setDrafts((prev) => ({ ...prev, [kind]: { ...draft, ...patch } }));
  };

  // With accounts linked, the amount follows their balances and can't be typed.
  const tracked = accountIds.length > 0;
  const errors = plainFieldErrors({ target, deadline, current: editing && !tracked ? current : undefined, monthly });
  const canSave = !!name.trim() && !errors.monthly && !errors.current && (kind ? resolved?.details != null : errors.ok);
  const targetNow = resolved?.target ?? (parseFloat(target) || null);

  // New: a kind picked and its preset name are not edits. Anything typed is.
  const dirty = goal
    ? JSON.stringify({ name, category, target, deadline, monthly, current, accountIds: [...accountIds].sort() }) !==
        JSON.stringify({ ...initial, icon: undefined, accountIds: [...initial.accountIds].sort() }) ||
      Object.keys(drafts).length > 0 ||
      useDetails !== (goal.details !== null)
    : !!(target || deadline || monthly || accountIds.length || Object.keys(drafts).length || plainKinds.length) ||
      (!!name.trim() && !GOAL_PRESETS.some((q) => q.name === name.trim()));
  const leave = useDiscardGuard(dirty && !saving && !deleting);

  // A link that opens the sheet on a part of it: the plan field takes the keyboard, accounts scroll into view.
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [accountsY, setAccountsY] = useState<number | null>(null);
  useEffect(() => {
    if (focus === "accounts" && accountsY !== null) setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, accountsY - 12), animated: true }), 350);
  }, [focus, accountsY]);

  const choose = (p: GoalPreset) => {
    Haptics.selectionAsync();
    setCategory(p.category);
    setIconKey(p.icon);
    // A preset is a start, never a reset: a name still holding a preset's text follows the kind.
    const untouched = !name.trim() || GOAL_PRESETS.some((q) => q.name === name.trim());
    if (untouched) setName(p.name);
    setPage("form");
  };

  const confirm = (title: string, body: string, ok: string) =>
    new Promise<boolean>((resolve) =>
      Alert.alert(title, body, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: ok, onPress: () => resolve(true) },
      ]),
    );

  const save = async () => {
    if (!canSave) return;
    if (editing && goal && !dirty) return router.back();
    // Linking accounts to a goal tracked by hand replaces the amount typed in.
    if (goal && goal.accountIds.length === 0 && parseFloat(goal.currentAmount) > 0 && tracked) {
      if (!(await confirm("Replace manual amount?", "Linking accounts will track this goal from their balances and replace the amount you entered.", "Link accounts"))) return;
    }
    setSaving(true);
    setError(null);
    const body: GoalWrite = {
      name: name.trim(),
      targetAmount: resolved?.target ?? parseFloat(target),
      monthlyContribution: monthly === "" ? null : parseFloat(monthly),
      deadline: (resolved ? resolved.deadline : deadline) || null,
      accountIds,
    };
    try {
      if (goal) {
        // Back to a plain amount clears the description, so a goal never keeps a derivation that contradicts its target.
        body.details = resolved ? resolved.details : goal.details ? null : undefined;
        if (!tracked) body.currentAmount = parseFloat(current);
        await goalsApi.update(goal.id, body);
      } else {
        const created = await goalsApi.create({
          ...body,
          name: body.name!,
          targetAmount: body.targetAmount!,
          monthlyContribution: monthly === "" ? undefined : body.monthlyContribution,
          deadline: body.deadline ?? undefined,
          details: resolved?.details ?? undefined,
          category,
          icon: iconKey,
        });
        invalidateGoals(qc);
        leave();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        markWebStale();
        showToast({ tone: "positive", title: `Created ${body.name}`, duration: 6000, action: { label: "View goal", onPress: () => openPath(`/goals/${created.goal.id}`) } });
        return;
      }
    } catch (e) {
      setError(saveErrorText(e, editing ? "Couldn't save these changes. Check them and try again." : "Couldn't create this goal. Check it and try again."));
      setSaving(false);
      return;
    }
    invalidateGoals(qc);
    leave();
    committed("Changes saved");
  };

  const remove = () => {
    if (!goal) return;
    Alert.alert(`Delete "${goal.name}"?`, "This permanently removes the goal. Linked accounts are not affected.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete goal",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await goalsApi.remove(goal.id);
          } catch {
            setDeleting(false);
            failed("Couldn't delete this goal. Try again.");
            return;
          }
          markGoalDeleted(goal.id);
          invalidateGoals(qc);
          leave();
          committed(`Deleted ${goal.name}`);
        },
      },
    ]);
  };

  // ── Step 1: what it's for ─────────────────────────────────────────────────
  if (page === "kind") {
    return (
      <>
        <SheetBar title="New goal" left={{ title: "Cancel", onPress: () => router.back() }} />
        <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
          <View style={formStyles.section}>
            <SectionHeader>What are you saving for?</SectionHeader>
            <View style={styles.grid}>
              {GOAL_PRESETS.map((p) => {
                const on = p.category === category && name !== "";
                return (
                  <Pressable
                    key={p.category}
                    onPress={() => choose(p)}
                    accessibilityRole="button"
                    accessibilityLabel={p.name}
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [styles.kindSlot, oneColumn && { flexBasis: "100%" }, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Card style={[styles.kind, on && { borderWidth: 1.5, borderColor: t.brandInk }]}>
                      <GoalTile iconKey={p.icon} color={goalColor(t, p.category)} size={36} variant="soft" />
                      <Text style={[styles.kindName, { color: t.content }]} numberOfLines={2}>
                        {p.name}
                      </Text>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </>
    );
  }

  // ── Step 2: the fields ────────────────────────────────────────────────────
  const chosen = presetFor(category);
  const money = (set: (v: string) => void) => (v: string) => set(decimal2(v));
  return (
    <>
      <SheetBar
        title={editing ? "Edit goal" : "New goal"}
        left={openedOnForm ? { title: "Cancel", onPress: () => router.back(), disabled: saving || deleting } : { title: "Back", symbol: "chevron.left", onPress: () => setPage("kind"), disabled: saving }}
        right={{ title: editing ? "Save" : "Create goal", strong: true, busy: saving, disabled: !canSave || deleting, onPress: () => void save() }}
      />
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={formStyles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {/* The kind chosen in step 1. Change goes back to it. */}
        {!editing && chosen ? (
          <Group>
            <Pressable
              onPress={() => setPage("kind")}
              accessibilityRole="button"
              accessibilityLabel={`${chosen.name}. Change the kind of goal`}
              style={({ pressed }) => [styles.chosen, pressFeedback(t, pressed)]}
            >
              <GoalTile iconKey={chosen.icon} color={goalColor(t, chosen.category)} size={36} variant="soft" />
              <Text style={[styles.chosenName, { color: t.content }]} numberOfLines={2}>
                {chosen.name}
              </Text>
              <Text style={[styles.change, { color: t.brandInk }]}>Change</Text>
            </Pressable>
          </Group>
        ) : null}

        <View style={formStyles.section}>
          <SectionHeader>Details</SectionHeader>
          <Group>
            <InputRow label="Goal name" value={name} onChange={setName} autoCapitalize="words" placeholder="Emergency Fund" />
            {kind ? null : (
              <>
                <Divider />
                <InputRow label="Target amount" value={target} onChange={money(setTarget)} money keyboardType="decimal-pad" placeholder="25,000" />
                <Divider />
                <DateRow label="Target date" value={deadline} onChange={setDeadline} />
              </>
            )}
          </Group>
          <FieldErrors messages={kind ? [] : [target === "" ? undefined : errors.target, errors.deadline]} />
        </View>

        {kind && draft && resolved && !resolved.spendUnavailable ? (
          <TypedFields kind={kind} draft={draft} onChange={patchDraft} resolved={resolved} ctx={ctx} savedByAge={savedAge != null} />
        ) : null}
        {resolved ? (
          resolved.spendUnavailable ? (
            <NoSpendData onSetPlainTarget={() => (editing ? setUseDetails(false) : setPlainKinds((p) => [...p, category]))} />
          ) : (
            <TargetReadout resolved={resolved} saved={editing ? parseFloat(current) || 0 : 0} onUseMonthlyPlan={(amt) => setMonthly(String(amt))} />
          )
        ) : null}

        {/* A typed kind can drop to a plain amount and back. */}
        {typed && !resolved?.spendUnavailable ? (
          <View style={styles.switch}>
            {kind ? (
              <TextLink
                title="Use a target amount instead"
                onPress={() => {
                  // Carry over what the readout shows, so the edit just made isn't undone.
                  if (resolved?.target != null) {
                    setTarget(String(resolved.target));
                    setDeadline(resolved.deadline ?? "");
                  }
                  if (editing) setUseDetails(false);
                  else setPlainKinds((p) => [...p, category]);
                }}
              />
            ) : (
              <TextLink
                title={CALCULATE_LABELS[category as TypedGoalCategory]}
                onPress={() => (editing ? setUseDetails(true) : setPlainKinds((p) => p.filter((k) => k !== category)))}
              />
            )}
          </View>
        ) : null}

        <View style={formStyles.section}>
          <SectionHeader>Saving</SectionHeader>
          <Group>
            <InputRow label="Monthly contribution" value={monthly} onChange={money(setMonthly)} money keyboardType="decimal-pad" placeholder="Optional" autoFocus={focus === "monthly"} />
            {editing && !tracked ? (
              <>
                <Divider />
                <InputRow label="Current amount" value={current} onChange={money(setCurrent)} money keyboardType="decimal-pad" placeholder="0" />
              </>
            ) : null}
          </Group>
          <FieldErrors messages={[errors.monthly, editing && !tracked ? errors.current : undefined]} />
        </View>

        {/* The accounts that fund it. Linking them is how a goal normally tracks progress, so they are in view. */}
        {fundable.length > 0 ? (
          <View style={formStyles.section} onLayout={(e) => setAccountsY(e.nativeEvent.layout.y)}>
            <SectionHeader>Accounts for this goal</SectionHeader>
            <Text style={[formStyles.footnote, { color: t.contentMuted }]}>Progress follows their balances.</Text>
            <AccountPicker
              accounts={fundable}
              selected={accountIds}
              onToggle={(id) => setAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
              preferType={preferredAccountType(category)}
              pinned={pinned}
              target={targetNow}
            />
          </View>
        ) : null}

        {error ? (
          <Text style={[formStyles.error, { color: t.negative }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {/* The goal's one Delete, at the foot of its settings. */}
        {editing ? (
          <Group>
            <Pressable
              onPress={remove}
              disabled={deleting || saving}
              accessibilityRole="button"
              accessibilityLabel="Delete goal"
              style={({ pressed }) => [styles.delete, pressFeedback(t, pressed)]}
            >
              {deleting ? <ActivityIndicator /> : <Text style={[styles.deleteText, { color: t.negative }]}>Delete goal</Text>}
            </Pressable>
          </Group>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    kindSlot: { flexBasis: "47%", flexGrow: 1 },
    kind: { flex: 1, minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
    kindName: { ...type.subhead, ...weight.semibold, flexShrink: 1 },
    chosen: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: space.rowInset },
    chosenName: { ...type.body, ...weight.semibold, flex: 1 },
    change: { ...type.subhead, ...weight.semibold },
    switch: { paddingHorizontal: space.card, alignItems: "flex-start" },
    delete: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space.rowInset },
    deleteText: { ...type.body, ...weight.semibold },
  }),
);
