import { useQueryClient } from "@tanstack/react-query";
import { File } from "expo-file-system";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { saveErrorText } from "@/api/client";
import { taxApi } from "@/api/tax";
import { useTheme as useDesign } from "@/design";
import { fileProblem, formatFileSize, mimeFor, PRIVACY_POINTS } from "@/lib/tax";
import { icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { committed } from "@/ui/feedback";
import { formStyles, SectionHeader, Segmented, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";

type Mode = "file" | "text";
type Picked = { uri: string; name: string; type: string; size: number | null };

/**
 * Add a tax document (the web's upload panel, as a sheet): a PDF, PNG or JPG
 * to read, or the situation described in words for anyone who would rather
 * not upload. Save sends it to be read. What happens to it is said here,
 * where the choice to upload is made.
 */
export default function TaxAddSheet() {
  const t = useTheme();
  const d = useDesign();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<Picked | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = mode === "file" ? !!file : text.trim().length > 0;
  const leave = useDiscardGuard(ready && !saving);

  const pick = async () => {
    setError(null);
    try {
      const res = await File.pickFileAsync({ mimeTypes: ["application/pdf", "image/jpeg", "image/png"] });
      if (res.canceled || !res.result) return;
      const f = res.result;
      const picked: Picked = { uri: f.uri, name: f.name, type: f.type || mimeFor(f.name), size: Number.isFinite(f.size) ? f.size : null };
      const problem = fileProblem(picked);
      if (problem) return setError(problem);
      setFile(picked);
    } catch {
      setError("Couldn't open that file. Try another.");
    }
  };

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const docs = await taxApi.submit(mode === "file" && file ? { file: { uri: file.uri, name: file.name, type: file.type } } : { text: text.trim() });
      void qc.invalidateQueries({ queryKey: ["tax"] });
      void qc.invalidateQueries({ queryKey: ["insights"] });
      committed(docs.length > 1 ? `Added ${docs.length} documents` : "Document added");
      leave();
    } catch (e) {
      setError(mode === "file" ? `We could not read ${file?.name ?? "that file"}. ${saveErrorText(e, "Nothing was saved. Fix or replace it, then try again.")}` : saveErrorText(e, "Couldn't save that. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SheetBar
        title="Add a document"
        left={{ title: "Cancel", onPress: () => leave(), disabled: saving }}
        right={{ title: "Save", strong: true, busy: saving, disabled: !ready, onPress: () => void save() }}
      />
      <ScrollView contentInsetAdjustmentBehavior="never" keyboardShouldPersistTaps="handled" contentContainerStyle={formStyles.body}>
        <Segmented
          accessibilityLabel="Upload or describe"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          options={[
            { value: "file", label: "Upload a file" },
            { value: "text", label: "Describe it" },
          ]}
        />

        {mode === "file" ? (
          <View style={formStyles.section}>
            {file ? (
              <Card style={styles.file}>
                <View style={[styles.tile, { backgroundColor: t.faintFill }]}>
                  <SymbolView name="doc.text" size={icon.md} tintColor={t.contentSecondary} accessibilityElementsHidden importantForAccessibility="no" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.name, { color: t.content }]} numberOfLines={1} ellipsizeMode="middle">
                    {file.name}
                  </Text>
                  {file.size != null ? <Text style={[styles.meta, { color: t.contentMuted }]}>{formatFileSize(file.size)}</Text> : null}
                </View>
                <Pressable onPress={() => setFile(null)} disabled={saving} accessibilityRole="button" accessibilityLabel={`Remove ${file.name}`} hitSlop={10} style={styles.remove}>
                  <SymbolView name="xmark.circle.fill" size={icon.lg} tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
                </Pressable>
              </Card>
            ) : (
              <Button title="Choose a file" variant="secondary" icon="doc.badge.plus" iconLeading onPress={() => void pick()} />
            )}
            <Text style={[formStyles.footnote, { color: t.contentMuted }]}>A PDF, PNG or JPG, up to 20 MB.</Text>
          </View>
        ) : (
          <View style={formStyles.section}>
            <SectionHeader>Describe your taxes</SectionHeader>
            {/* The theme's inset fill (the Segmented track's), so the box shows on the sheet in every skin. */}
            <View style={{ backgroundColor: d.color.surfaceInset, borderRadius: d.radius.md }}>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                autoFocus
                editable={!saving}
                placeholder={"Married filing jointly, 2025\nW-2 income $120k, withheld $18k\nStandard deduction, no dependents"}
                placeholderTextColor={t.contentFaint}
                keyboardAppearance={t.keyboard}
                selectionColor={t.brandInk}
                accessibilityLabel="Describe your taxes"
                style={[styles.textarea, { color: t.content }]}
              />
            </View>
          </View>
        )}

        {error ? (
          <Text style={[formStyles.error, { color: t.negative }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {mode === "file" ? (
          <View style={formStyles.section}>
            <SectionHeader>What happens to a document you upload</SectionHeader>
            <Card style={{ gap: 10 }}>
              {PRIVACY_POINTS.map((p) => (
                <View key={p} style={styles.point}>
                  <View style={[styles.dot, { backgroundColor: t.contentFaint }]} />
                  <Text style={[styles.pointText, { color: t.contentSecondary }]}>{p}</Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    file: { flexDirection: "row", alignItems: "center", gap: 12 },
    tile: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
    name: { ...type.callout, ...weight.semibold },
    meta: { ...type.footnote },
    remove: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    textarea: { ...type.body, minHeight: 140, paddingHorizontal: space.rowInset, paddingVertical: 12, textAlignVertical: "top" },
    point: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8 },
    pointText: { ...type.subhead, flex: 1 },
  }),
);
