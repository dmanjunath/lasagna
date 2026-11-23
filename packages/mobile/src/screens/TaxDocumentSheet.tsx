import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Fragment, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { taxApi } from "@/api/tax";
import { InfoRow } from "@/components/accounts/InfoRow";
import { formatStoredDay } from "@/lib/format";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { verdictInk } from "@/design/meaning";
import { docLabel, fieldGroups, formatFieldKey, formatFieldValue, hasRealFile, returnFieldVerdict } from "@/lib/tax";
import { useTheme as useDesign } from "@/design";
import { space, themedStyles, type, useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { committed, failed } from "@/ui/feedback";
import { Divider, formStyles, SectionHeader, SheetBar } from "@/ui/Form";
import { Skeleton } from "@/ui/Skeleton";
import { ErrorState } from "@/ui/State";

/**
 * One tax document (the web's expanded row): what was read from it, field by
 * field, and Delete at the foot. The original file was never stored, so a
 * delete removes the figures and cannot be undone.
 */
export default function TaxDocumentSheet({ id }: { id: string }) {
  const t = useTheme();
  const d = useDesign();
  const hidden = useAmountsHidden();
  const qc = useQueryClient();
  // `hidden` above also re-masks the money fields on toggle.
  const q = useQuery({ queryKey: ["tax", "document", id], queryFn: () => taxApi.document(id) });
  const [deleting, setDeleting] = useState(false);
  const doc = q.data?.document;
  const label = doc ? docLabel(doc).label : "Document";

  const remove = () =>
    Alert.alert(`Delete ${label}?`, "The extracted fields are removed and the strategies built from them are recalculated. The original file was never stored, so this cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await taxApi.remove(id);
          } catch {
            setDeleting(false);
            failed(`Could not delete ${label}. Nothing was removed.`);
            return;
          }
          void qc.invalidateQueries({ queryKey: ["tax"] });
          void qc.invalidateQueries({ queryKey: ["insights"] });
          committed("Document deleted");
          router.back();
        },
      },
    ]);

  return (
    <>
      <SheetBar title={label} right={{ title: "Done", strong: true, onPress: () => router.back() }} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
        {q.isPending ? (
          <Card style={{ gap: 12 }}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="100%" height={12} />
            <Skeleton width="80%" height={12} />
          </Card>
        ) : q.isError || !doc ? (
          <ErrorState compact title="Couldn't load this document" body="Check your connection and try again." onRetry={() => void q.refetch()} />
        ) : (
          <>
            <View style={styles.meta}>
              {hasRealFile(doc) ? (
                <Text style={[styles.line, { color: t.contentSecondary }]} numberOfLines={1} ellipsizeMode="middle">
                  {doc.fileName}
                </Text>
              ) : null}
              {doc.createdAt ? <Text style={[styles.line, { color: t.contentMuted }]}>{`Added ${formatStoredDay(doc.createdAt, { year: "numeric" })}`}</Text> : null}
              <Text style={[styles.line, { color: t.contentMuted }]}>The original file was not stored.</Text>
            </View>
            {fieldGroups(doc.llmFields).length === 0 ? (
              <Text style={[styles.line, styles.meta, { color: t.contentMuted }]}>No extracted fields available.</Text>
            ) : (
              fieldGroups(doc.llmFields).map((g) => (
                <View key={g.title ?? "fields"} style={formStyles.section}>
                  <SectionHeader>{g.title ?? "Extracted fields"}</SectionHeader>
                  <Card style={styles.listCard}>
                    {g.entries.map(([k, v], i) => {
                      // Meaningful color: a 1040's stated refund reads basil, its amount owed sauce.
                      const verdict = hidden ? null : returnFieldVerdict(doc.llmFields, k, v);
                      return (
                        <Fragment key={k}>
                          {i > 0 ? <Divider /> : null}
                          <InfoRow label={formatFieldKey(k)} value={formatFieldValue(v, k)} money={typeof v === "number"} color={verdict ? verdictInk(d.color, verdict) : undefined} />
                        </Fragment>
                      );
                    })}
                  </Card>
                </View>
              ))
            )}
            <Button variant="destructive" title="Delete document" loading={deleting} onPress={remove} />
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    meta: { gap: 2, paddingHorizontal: space.card },
    line: { ...type.footnote },
    listCard: { padding: 0 },
  }),
);
