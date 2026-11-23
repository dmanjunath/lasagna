import { useQuery } from "@tanstack/react-query";
import { toActionRow } from "@web/lib/action-rows";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { insightsApi, pathApi } from "@/api/home";
import { useAuth } from "@/auth/AuthProvider";
import { ActionGroup } from "@/components/actions/ActionGroup";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { StatePill, StepTile } from "@/components/journey/JourneyParts";
import { useStepMark } from "@/components/journey/useStepMark";
import { openChat } from "@/lib/chat";
import { stripAccountMask } from "@/lib/account-list";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { aprLabel, canTick, levelStateOf, stepAccount, stepActions, stepDetail, stepGuidance, stepHelpPrompt } from "@/lib/journey";
import { openPath } from "@/lib/navigation";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardSkeleton } from "@/ui/Card";
import { SectionHeader } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { Sparkle } from "@/ui/Sparkle";
import { EmptyState, ErrorState } from "@/ui/State";
import { Track } from "@/ui/Track";

/**
 * One step of the path, pushed from the journey page (the web's inline
 * FocusArticle): why it is on your path, what to do now, why it sits where it
 * does, the account or goal it acts on, the actions that serve it, and the
 * marks. Mark done and Not applicable work as on Home's journey card, Undo
 * in the toast.
 */
export default function JourneyStepScreen({ id }: { id: string }) {
  const t = useTheme();
  useAmountsHidden(); // the step's copy carries amounts
  const path = useQuery({ queryKey: ["financial-path"], queryFn: pathApi.get });
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  const verbs = useActionVerbs();
  const { user } = useAuth();
  const canMark = !user?.isDemo;
  const { mark, busy } = useStepMark();

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([path.refetch(), insights.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  if (path.isPending) {
    return (
      <ScreenScroll title="" header={<Skeleton width="70%" height={30} style={styles.titleSkeleton} />}>
        <CardSkeleton lines={5} />
        <CardSkeleton lines={2} />
      </ScreenScroll>
    );
  }
  const bare = { title: "", headerTransparent: false, headerBackground: undefined, headerTitle: undefined };
  if (path.isError && !path.data) {
    return (
      <>
        <Stack.Screen options={bare} />
        <ErrorState title="We couldn't load this step" body="Your steps and everything you have marked are safe. Trying again usually works." onRetry={() => void path.refetch()} />
      </>
    );
  }
  const data = path.data!;
  const step = data.steps.find((s) => s.id === id);
  if (!step) {
    return (
      <>
        <Stack.Screen options={bare} />
        <EmptyState
          gutter
          art={false}
          icon="square.3.layers.3d"
          title="This step isn't on your path"
          body="It may have been taken off, or your path changed since."
          action={{ title: "Back to your journey", onPress: () => (router.canGoBack() ? router.back() : openPath("/financial-level")) }}
        />
      </>
    );
  }

  const state = levelStateOf(step, data.currentStepId);
  const complete = step.status === "complete";
  const pct = Math.max(0, Math.min(100, Math.round(step.progress || 0)));
  const detail = stepDetail(step);
  const guidance = stepGuidance(step, state);
  const account = step.kind === "debt" ? stepAccount(step) : null;
  const actions = stepActions(insights.data?.insights ?? [], step.id).map(toActionRow);
  // Every row this screen ticked was one of this step's.
  const doneHere = verbs.done;
  const title = maskCurrencyInText(step.title);
  const spinning = (status: string) => busy?.id === step.id && busy.status === status;

  const setAside = async () => {
    // Off the path, the step has no screen left to show.
    if (await mark(step, "not_applicable")) router.back();
  };

  return (
    <ScreenScroll title={title} refreshing={pulling} onRefresh={() => void onPull()}>
      <View style={styles.meta}>
        <StepTile step={step} state={state} size={32} />
        <Text style={[styles.metaText, { color: t.contentMuted }]}>{`Step ${step.order} of ${data.steps.length}`}</Text>
        <StatePill state={state} rateShaped={step.rateShaped} />
        {state === "done" ? <Sparkle size={16} /> : null}
      </View>

      {/* Why it is on this path: their own reason first, then the general one. */}
      <Card style={styles.about}>
        {step.why ? <Text style={[styles.why, { color: t.content }]}>{maskCurrencyInText(step.why)}</Text> : null}
        {step.description ? <Text style={[styles.description, { color: t.contentSecondary }]}>{maskCurrencyInText(step.description)}</Text> : null}
        {!complete && pct > 0 ? (
          <View style={{ gap: 8, marginTop: 4 }}>
            <Track pct={pct} color={t.brand} />
            {detail ? <Text style={[styles.detail, { color: t.contentMuted }]}>{maskCurrencyInText(detail)}</Text> : null}
          </View>
        ) : null}
      </Card>

      {/* What it asks for now, or where it stands. */}
      {guidance || step.notes.length > 0 ? (
        <Card style={{ gap: 6 }}>
          {guidance?.heading ? <Text style={[styles.label, { color: t.contentMuted }]}>{guidance.heading}</Text> : null}
          {guidance ? <Text style={[styles.guidance, { color: t.content }]}>{maskCurrencyInText(guidance.text)}</Text> : null}
          {step.notes.map((n) => (
            <Text key={n} style={[styles.note, { color: t.contentMuted }]}>
              {maskCurrencyInText(n)}
            </Text>
          ))}
        </Card>
      ) : null}

      {/* Why it sits here: the one part of the path chosen for this person. */}
      {step.reason ? (
        <View style={styles.section}>
          <SectionHeader>Why it sits here</SectionHeader>
          <Card>
            <Text style={[styles.description, { color: t.contentSecondary }]}>{maskCurrencyInText(step.reason)}</Text>
          </Card>
        </View>
      ) : null}

      {step.note ? (
        <View style={styles.section}>
          <SectionHeader>{complete ? "Your note" : "Your note from when you marked this done"}</SectionHeader>
          <Card>
            <Text style={[styles.description, styles.quote, { color: t.contentSecondary }]}>{`"${step.note}"`}</Text>
          </Card>
        </View>
      ) : null}

      {/* The one account or goal the step acts on. */}
      {account || step.goal ? (
        <Card style={styles.listCard}>
          {account ? (
            <LinkRow
              title={account.mask ? `${stripAccountMask(account.name, account.mask)} ••${account.mask}` : account.name}
              detail={account.apr == null ? aprLabel(null) : null}
              onPress={() => openPath(`/accounts/${account.id}`)}
            />
          ) : null}
          {step.goal ? <LinkRow title={step.goal.name} detail={null} onPress={() => openPath(`/goals/${step.goal!.id}`)} /> : null}
        </Card>
      ) : null}

      {actions.length > 0 || doneHere.length > 0 ? (
        <ActionGroup
          title={actions.length + doneHere.length === 1 ? "Action for this step" : "Actions for this step"}
          rows={actions}
          done={doneHere}
          onComplete={verbs.complete}
          onSnooze={verbs.snooze}
          onDismiss={verbs.dismiss}
        />
      ) : null}

      <View style={styles.buttons}>
        <Button title="Walk me through this" icon="arrow.right" variant={complete ? "secondary" : "primary"} onPress={() => openChat(stepHelpPrompt(step), step.title)} disabled={busy !== null} />
        {/* A step the figures measure completes itself, so only an unmeasured one takes a tick. */}
        {canMark && canTick(step) && !complete ? (
          <Button title="Mark done" variant="secondary" icon="checkmark" iconLeading loading={spinning("done")} disabled={busy !== null} onPress={() => void mark(step, "done")} />
        ) : null}
        {canMark && canTick(step) && complete ? (
          <Button title="Mark not done" variant="secondary" loading={spinning("pending")} disabled={busy !== null} onPress={() => void mark(step, "pending", "done")} />
        ) : null}
        {canMark && !complete ? (
          <Button title="Not applicable to me" variant="plain" loading={spinning("not_applicable")} disabled={busy !== null} onPress={() => void setAside()} />
        ) : null}
      </View>
    </ScreenScroll>
  );
}

function LinkRow({ title, detail, onPress }: { title: string; detail: string | null; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: t.canvasSunken }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.linkTitle, { color: t.content }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? <Text style={[styles.linkDetail, { color: t.brandInk }]}>{detail}</Text> : null}
      </View>
      <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    titleSkeleton: { marginHorizontal: space.card, marginVertical: 4 },
    meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingHorizontal: space.card, marginTop: -4 },
    metaText: { ...type.subhead, ...weight.semibold },
    about: { gap: 8 },
    why: { ...type.callout, ...weight.semibold },
    description: { ...type.subhead },
    quote: { fontStyle: "italic" },
    detail: { ...type.footnote, ...weight.semibold, fontVariant: ["tabular-nums"] },
    label: { ...type.footnote, ...weight.semibold },
    guidance: { ...type.callout, ...weight.semibold },
    note: { ...type.footnote, marginTop: 4 },
    section: { gap: 6 },
    listCard: { padding: 0 },
    linkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: space.rowInset, paddingVertical: 8 },
    linkTitle: { ...type.callout, ...weight.semibold },
    linkDetail: { ...type.footnote, ...weight.semibold },
    buttons: { gap: 8, marginTop: 4 },
  }),
);
