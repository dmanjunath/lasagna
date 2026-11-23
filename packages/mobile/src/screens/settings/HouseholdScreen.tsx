import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { householdApi, type Member } from "@/api/profile";
import { useAuth } from "@/auth/AuthProvider";
import { Badge, ScreenLead } from "@/components/profile/SettingsParts";
import { formatMoney } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { pushInTab } from "@/lib/navigation";
import { inviteLine, NOT_SET } from "@/lib/profile";
import { radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardSkeleton } from "@/ui/Card";
import { committed, failed } from "@/ui/feedback";
import { Divider, SectionHeader } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { ErrorState } from "@/ui/State";

/** The household's queries, refetched after any change (Home's invite shortcut reads ["household"]). */
export function invalidateHousehold(qc: ReturnType<typeof useQueryClient>) {
  for (const key of [["household-profiles"], ["household-invites"], ["household"]]) void qc.invalidateQueries({ queryKey: key });
}

/**
 * Household (Settings.tsx HouseholdSection): every member with their own
 * profile figures, Remove for the owner, Leave for a member, and the owner's
 * invites. Inviting opens a sheet.
 */
export default function HouseholdScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  useAmountsHidden(); // members' incomes
  const { user, signOut } = useAuth();
  const isOwner = user?.role === "owner";
  const members = useQuery({ queryKey: ["household-profiles"], queryFn: householdApi.profiles });
  const invites = useQuery({ queryKey: ["household-invites"], queryFn: householdApi.invites, enabled: isOwner });
  const [busy, setBusy] = useState<string | null>(null);

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([members.refetch(), isOwner ? invites.refetch() : null]);
    } finally {
      setPulling(false);
    }
  };

  const remove = (m: Member) =>
    Alert.alert(`Remove ${m.name || m.email}?`, "They'll lose their login and their private chat history. Your shared accounts and financial data stay intact.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(m.userId);
          try {
            await householdApi.remove(m.userId);
          } catch {
            failed("Couldn't remove that member. Try again.");
            return;
          } finally {
            setBusy(null);
          }
          invalidateHousehold(qc);
          committed(`Removed ${m.name || m.email}`);
        },
      },
    ]);

  const leave = () =>
    Alert.alert("Leave this household?", "You'll lose access to these shared accounts and your login here. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          try {
            await householdApi.leave();
          } catch {
            failed("Couldn't leave the household. Try again.");
            return;
          }
          // The server ended this login, so this device signs out.
          await signOut();
        },
      },
    ]);

  const revoke = async (id: string, email: string) => {
    setBusy(id);
    try {
      await householdApi.revoke(id);
    } catch {
      failed("Couldn't revoke that invite. Try again.");
      return;
    } finally {
      setBusy(null);
    }
    invalidateHousehold(qc);
    committed(`Revoked the invite to ${email}`);
  };

  const list = members.data?.members ?? [];
  const pending = invites.data?.invites ?? [];

  return (
    <ScreenScroll title="Household" refreshing={pulling} onRefresh={() => void onPull()}>
      <ScreenLead>Share your accounts and financial picture with a partner. Each gets their own login and private chat.</ScreenLead>
      {members.isPending ? (
        <CardSkeleton lines={3} />
      ) : members.isError && !members.data ? (
        <ErrorState compact title="Couldn't load your household" body="Check your connection and try again." onRetry={() => void members.refetch()} />
      ) : (
        <View style={styles.section}>
          <SectionHeader trailing={{ text: String(list.length), color: t.contentMuted }}>Members</SectionHeader>
          <Card style={styles.listCard}>
            {list.map((m, i) => (
              <Fragment key={m.userId}>
                {i > 0 ? <Divider /> : null}
                <MemberRow member={m} canRemove={isOwner && !m.isYou && m.role !== "owner"} busy={busy === m.userId} onRemove={() => remove(m)} />
              </Fragment>
            ))}
            {!isOwner ? (
              <>
                <Divider />
                <View style={styles.footer}>
                  <Button title="Leave household" variant="plain" size="compact" icon="rectangle.portrait.and.arrow.right" iconLeading onPress={leave} style={{ alignSelf: "flex-start" }} />
                </View>
              </>
            ) : null}
          </Card>
        </View>
      )}

      {isOwner ? (
        <View style={styles.section}>
          <Card style={{ gap: 12 }}>
            <Text style={[styles.body, { color: t.contentSecondary }]}>They'll get an email link to create their own login on this household.</Text>
            <Button title="Invite a partner" variant="tinted" size="compact" icon="person.badge.plus" iconLeading style={{ alignSelf: "flex-start" }} onPress={() => pushInTab("/household-invite")} />
            {pending.length > 0 ? (
              <View>
                {pending.map((inv) => {
                  const line = inviteLine(inv.expiresAt);
                  return (
                    <Fragment key={inv.id}>
                      <Divider inset={0} />
                      <View style={styles.inviteRow}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[styles.rowTitle, { color: t.content }]} numberOfLines={1}>
                            {inv.email}
                          </Text>
                          <Text style={[styles.rowDetail, { color: line.expired ? t.caution : t.contentMuted }]}>{line.text}</Text>
                        </View>
                        <Button title="Revoke" variant="plain" size="compact" loading={busy === inv.id} accessibilityLabel={`Revoke the invite to ${inv.email}`} onPress={() => void revoke(inv.id, inv.email)} />
                      </View>
                    </Fragment>
                  );
                })}
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}
    </ScreenScroll>
  );
}

/** One member: who, their role, and their own profile's figures (a partner edits theirs from their own login). */
function MemberRow({ member: m, canRemove, busy, onRemove }: { member: Member; canRemove: boolean; busy: boolean; onRemove: () => void }) {
  const t = useTheme();
  const p = m.profile;
  const facts = [
    { label: "Income", value: p?.annualIncome != null ? `${formatMoney(p.annualIncome, true)}/yr` : null },
    { label: "Age", value: p?.age != null ? String(p.age) : null },
    { label: "Retire at", value: p?.retirementAge != null ? String(p.retirementAge) : null },
  ];
  return (
    <View style={styles.member}>
      <View style={styles.memberTop}>
        <View style={[styles.avatar, { backgroundColor: t.brandSoft }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[styles.avatarText, { color: t.brandInk }]}>{(m.name || m.email).trim().charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameLine}>
            <Text style={[styles.rowTitle, { color: t.content, flexShrink: 1 }]} numberOfLines={1}>
              {m.name || m.email}
            </Text>
            {m.isYou ? <Badge label="You" tone="brand" /> : null}
            {m.role === "owner" ? <Badge label="Owner" /> : null}
          </View>
          {m.name ? (
            <Text style={[styles.rowDetail, { color: t.contentMuted }]} numberOfLines={1}>
              {m.email}
            </Text>
          ) : null}
        </View>
        {canRemove ? <Button title="Remove" variant="plain" size="compact" loading={busy} accessibilityLabel={`Remove ${m.name || m.email}`} onPress={onRemove} /> : null}
      </View>
      <View style={[styles.facts, { backgroundColor: t.canvasSunken }]}>
        {facts.map((f) => (
          <View key={f.label} style={styles.fact} accessible accessibilityLabel={`${f.label}, ${f.value ?? NOT_SET}`}>
            <Text style={[styles.factLabel, { color: t.contentMuted }]}>{f.label}</Text>
            <Text style={[styles.factValue, { color: f.value ? t.content : t.contentFaint }]} numberOfLines={1}>
              {f.value ?? NOT_SET}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    section: { gap: 6 },
    listCard: { padding: 0 },
    member: { paddingHorizontal: space.rowInset, paddingVertical: 12, gap: 10 },
    memberTop: { flexDirection: "row", alignItems: "center", gap: 12 },
    avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    avatarText: { ...type.subhead, ...weight.bold },
    nameLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    rowTitle: { ...type.callout, ...weight.semibold },
    rowDetail: { ...type.footnote },
    facts: { flexDirection: "row", gap: 12, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
    fact: { flex: 1, gap: 2 },
    factLabel: { ...type.caption, ...weight.semibold },
    factValue: { ...type.subhead, ...weight.semibold, fontVariant: ["tabular-nums"] },
    footer: { paddingHorizontal: space.rowInset - 8, paddingVertical: 4 },
    body: { ...type.subhead },
    inviteRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  }),
);
