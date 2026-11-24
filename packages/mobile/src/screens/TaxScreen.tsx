import { useQuery } from "@tanstack/react-query";
import { ScopePills } from "@/components/transactions/ScopeRow";
import { SymbolView } from "expo-symbols";
import { Fragment, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { insightsApi } from "@/api/home";
import { profileApi } from "@/api/profile";
import { taxApi } from "@/api/tax";
import { ActionGroup } from "@/components/actions/ActionGroup";
import { useActionVerbs } from "@/components/actions/useActionVerbs";
import { relativeTime } from "@/lib/account-list";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { pushInTab } from "@/lib/navigation";
import { pageActions } from "@/lib/page-actions";
import {
  activeYear,
  ALL_YEARS,
  currentTaxYear,
  DOC_SORTS,
  docLabel,
  docSubtitle,
  docYears,
  FILING_LABELS,
  sortDocs,
  yearKey,
  yearLabel,
  type DocSort,
  type TaxDocumentSummary,
} from "@/lib/tax";
import { icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card, CardHeader } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Divider } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { ErrorState } from "@/ui/State";
import { pressFeedback } from "@/ui/press";

const HERE = "/tax";

/** The Add a document sheet. */
export const openAddTaxDocument = () => pushInTab("/tax-add");

/**
 * Where you stand on tax (/tax, tax-strategy.tsx on the web): what the
 * documents on file say, with the filing facts, then the page's actions, then
 * the documents, with Upload in their header. A document opens a sheet of its
 * extracted fields. The documents' year and sort are pills over the list.
 */
export default function TaxScreen() {
  const t = useTheme();
  useAmountsHidden(); // the summary and rows re-mask on toggle
  const docs = useQuery({ queryKey: ["tax", "documents"], queryFn: taxApi.documents });
  const summary = useQuery({ queryKey: ["tax", "summary"], queryFn: taxApi.summary });
  const profile = useQuery({ queryKey: ["financial-profile"], queryFn: profileApi.get });
  const insights = useQuery({ queryKey: ["insights"], queryFn: insightsApi.list });
  const verbs = useActionVerbs();
  const actions = useMemo(() => pageActions(insights.data?.insights ?? [], ["tax"]), [insights.data]);
  const doneHere = verbs.done.filter((r) => r.type === "tax");
  const [year, setYear] = useState<string | null>(null);
  const [sort, setSort] = useState<DocSort>("added-desc");

  const all = docs.data?.documents ?? [];
  const years = useMemo(() => docYears(all), [all]);
  const shownYear = activeYear(years, year);
  const visible = useMemo(() => sortDocs(shownYear === ALL_YEARS || shownYear === null ? all : all.filter((d) => yearKey(d.taxYear ?? null) === shownYear), sort), [all, shownYear, sort]);
  const mixedYears = shownYear === ALL_YEARS && years.length > 1;
  const hasDocs = all.length > 0;

  // One state for the hero, in the web's order: a summary on screen outranks everything after it.
  const hero = docs.isPending || (hasDocs && summary.isPending)
    ? "loading"
    : summary.data?.summary
      ? "summary"
      : summary.isError && !summary.data
        ? "summary-failed"
        : docs.isError && !docs.data
          ? "docs-error"
          : hasDocs
            ? "no-summary"
            : "first-run";

  const fp = profile.data?.financialProfile;
  const facts = [fp?.filingStatus ? (FILING_LABELS[fp.filingStatus] ?? fp.filingStatus) : null, fp?.stateOfResidence ?? null, `Tax year ${currentTaxYear()}`].filter(Boolean) as string[];

  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await Promise.all([docs.refetch(), summary.refetch(), profile.refetch(), insights.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  return (
    <>
      <ScreenScroll title="Tax" refreshing={pulling} onRefresh={() => void onPull()}>
        {/* 1. Where you stand: what the documents say, and the filing facts. */}
        <Card hero="wealth" style={{ gap: 12 }}>
          <CardHeader title="Your tax situation" />
          {hero === "loading" ? (
            <View style={{ gap: 8 }}>
              <Skeleton width="100%" height={13} />
              <Skeleton width="92%" height={13} />
              <Skeleton width="60%" height={13} />
            </View>
          ) : hero === "summary" ? (
            <View style={{ gap: 8 }}>
              {(summary.data?.summary ?? "")
                .replace(/\\n/g, "\n")
                .split(/\n+/)
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p, i) => (
                  <Text key={i} style={[styles.prose, { color: t.contentSecondary }]}>
                    {maskCurrencyInText(p)}
                  </Text>
                ))}
              {summary.data?.generatedAt ? <Text style={[styles.foot, { color: t.contentMuted }]}>{`Updated ${relativeTime(summary.data.generatedAt)}`}</Text> : null}
            </View>
          ) : hero === "summary-failed" ? (
            <ErrorState compact title="We could not load your summary" onRetry={() => void summary.refetch()} />
          ) : (
            <Text style={[styles.prose, { color: t.contentSecondary }]}>
              {hero === "docs-error"
                ? "No summary until your documents load."
                : hero === "no-summary"
                  ? "A summary is not available right now."
                  : "Add your W-2s, 1099s, or any tax form. We read the figures, describe what they show, and never store the original file."}
            </Text>
          )}
          {profile.isPending ? <Skeleton width="55%" height={12} /> : <Text style={[styles.facts, { color: t.contentMuted }]}>{facts.join(", ")}</Text>}
        </Card>

        {/* 2. The page's actions. */}
        {actions.length > 0 || doneHere.length > 0 ? (
          <ActionGroup title="Actions" rows={actions} done={doneHere} here={HERE} onComplete={verbs.complete} onSnooze={verbs.snooze} onDismiss={verbs.dismiss} />
        ) : null}

        {/* 3. The documents, with Upload in the header. */}
        <Card style={styles.listCard}>
          <View style={styles.cardHead}>
            <CardHeader title="Your documents" link={hasDocs ? { title: "Upload", label: "Upload a document", onPress: openAddTaxDocument } : undefined} />
            {hasDocs ? (
              <Text style={[styles.foot, { color: t.contentMuted }]}>
                {shownYear === ALL_YEARS || years.length <= 1 ? `${all.length} ${all.length === 1 ? "document" : "documents"}` : `${visible.length} of ${all.length} documents`}
              </Text>
            ) : null}
          </View>
          {years.length > 1 ? (
            <View style={styles.years} accessibilityRole="radiogroup" accessibilityLabel="Tax year">
              {[{ key: ALL_YEARS, label: "All years", count: all.length }, ...years].map((y) => (
                <Chip key={y.key} onCard label={`${y.label} (${y.count})`} accessibilityLabel={`${y.label}, ${y.count} ${y.count === 1 ? "document" : "documents"}`} selected={shownYear === y.key} onPress={() => setYear(y.key)} />
              ))}
            </View>
          ) : null}
          {visible.length > 1 ? (
            <View style={styles.years}>
              <ScopePills<DocSort> accessibilityLabel="Sort documents" value={sort} onChange={setSort} options={DOC_SORTS} />
            </View>
          ) : null}
          {docs.isPending ? (
            [0, 1, 2].map((i) => (
              <View key={i} style={styles.row}>
                <Skeleton width={40} height={40} style={{ borderRadius: radius.md }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width="50%" height={14} />
                  <Skeleton width="75%" height={12} />
                </View>
              </View>
            ))
          ) : docs.isError && !docs.data ? (
            <View style={styles.pad}>
              <ErrorState compact title="We could not load your documents" onRetry={() => void docs.refetch()} />
            </View>
          ) : hasDocs ? (
            visible.map((doc, i) => (
              <Fragment key={doc.id}>
                {i > 0 ? <Divider /> : null}
                <DocRow doc={doc} year={mixedYears ? yearLabel(doc.taxYear ?? null) : null} />
              </Fragment>
            ))
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.prose, { color: t.contentMuted }]}>No documents yet.</Text>
              <Button size="compact" title="Upload a document" icon="arrow.up.doc" iconLeading onPress={openAddTaxDocument} style={{ alignSelf: "flex-start" }} />
            </View>
          )}
        </Card>
      </ScreenScroll>
    </>
  );
}

function DocRow({ doc, year }: { doc: TaxDocumentSummary; year: string | null }) {
  const t = useTheme();
  const stacked = useWindowDimensions().fontScale > 1.3;
  const { label } = docLabel(doc);
  const sub = docSubtitle(doc);
  const subtitle = sub ? maskCurrencyInText(sub) : null;
  return (
    <Pressable
      onPress={() => pushInTab(`/tax-document?id=${encodeURIComponent(doc.id)}`)}
      accessibilityRole="button"
      accessibilityLabel={[label, subtitle, year ? (year === "Undated" ? "Undated" : `Tax year ${year}`) : null].filter(Boolean).join(", ")}
      accessibilityHint="Shows its extracted fields"
      style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
    >
      <View style={[styles.tile, { backgroundColor: t.faintFill }]}>
        <SymbolView name="doc.text" size={icon.md} tintColor={t.contentSecondary} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.name, { color: t.content }]} numberOfLines={stacked ? 3 : 1}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={[styles.meta, { color: t.contentSecondary }]} numberOfLines={stacked ? 4 : 2}>
            {subtitle}
          </Text>
        ) : null}
        {year ? <Text style={[styles.meta, { color: t.contentMuted }]}>{year === "Undated" ? "Undated" : `Tax year ${year}`}</Text> : null}
      </View>
      <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    prose: { ...type.callout },
    foot: { ...type.footnote, ...weight.medium },
    facts: { ...type.footnote, ...weight.semibold },
    listCard: { padding: 0, paddingBottom: 6 },
    cardHead: { paddingHorizontal: space.card, paddingTop: space.card, paddingBottom: 8, gap: 2 },
    years: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: space.card, paddingBottom: 8 },
    pad: { paddingHorizontal: space.card },
    empty: { paddingHorizontal: space.card, paddingBottom: space.card - 6, gap: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 12, minHeight: 64 },
    tile: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    name: { ...type.callout, ...weight.semibold },
    meta: { ...type.footnote },
  }),
);
