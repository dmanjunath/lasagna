import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { moneyDisplay } from "@/lib/format";
import { HIDDEN_AMOUNT, useAmountsHidden } from "@/lib/hide-amounts";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { accountsApi } from "@/api/accounts";
import { localDayKey } from "@/lib/format";
import { icon, inputType, space, themedStyles, type, useTheme, weight } from "@/theme";
import { CheckRow, Divider, FieldRow, formStyles, Group, SectionHeader, Segmented, SheetBar, useStackedRows } from "@/ui/Form";
import { pressFeedback } from "@/ui/press";

// The account sheets' fields, on the grouped-form primitives in ui/Form.

/** A labelled single-line input in a group row. */
export function InputRow({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoCapitalize = "none",
  money,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Takes the keyboard on arrival (a link that opens a form on this field). */
  autoFocus?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "words" | "sentences" | "characters";
  /** A dollar amount: shown formatted ($14,753.39) while the field isn't being edited, masked while amounts are hidden. */
  money?: boolean;
}) {
  const t = useTheme();
  const stacked = useStackedRows();
  const [focused, setFocused] = useState(false);
  const hidden = useAmountsHidden();
  const shown = money && !focused ? (hidden && value.trim() !== "" ? HIDDEN_AMOUNT : moneyDisplay(value)) : value;
  return (
    <FieldRow label={label}>
      <TextInput
        value={shown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.contentFaint}
        keyboardType={keyboardType}
        keyboardAppearance={t.keyboard}
        selectionColor={t.brandInk}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        returnKeyType="done"
        clearButtonMode="while-editing"
        autoFocus={autoFocus}
        accessibilityLabel={label}
        style={[formStyles.input, stacked && formStyles.inputStacked, { color: t.content }]}
      />
    </FieldRow>
  );
}

const fromKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** A date: the native compact picker with a clear button, or Add date while unset. `max` caps it, `start` is where Add date begins (today by default). */
export function DateRow({ label, value, onChange, max, start }: { label: string; value: string; onChange: (v: string) => void; max?: string; start?: string }) {
  const t = useTheme();
  return (
    <FieldRow label={label}>
      {value ? (
        <>
          <DateTimePicker value={fromKey(value)} maximumDate={max ? fromKey(max) : undefined} mode="date" display="compact" accentColor={t.brandInk} onChange={(_, d) => d && onChange(localDayKey(d))} accessibilityLabel={label} />
          <Pressable onPress={() => onChange("")} accessibilityRole="button" accessibilityLabel={`Clear ${label}`} hitSlop={10}>
            <SymbolView name="xmark.circle.fill" size={icon.md} tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
          </Pressable>
        </>
      ) : (
        <Pressable onPress={() => onChange(start ?? localDayKey(new Date()))} accessibilityRole="button" accessibilityLabel={`Set ${label}`} hitSlop={8} style={styles.add}>
          <Text style={[styles.addText, { color: t.brandInk }]}>Add date</Text>
        </Pressable>
      )}
    </FieldRow>
  );
}

/** A switch with a line saying what it does. The whole row flips it. */
export function ToggleRow({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  const flip = (v: boolean) => {
    Haptics.selectionAsync();
    onChange(v);
  };
  return (
    <Pressable
      onPress={() => flip(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={detail}
      style={({ pressed }) => [styles.toggle, pressFeedback(t, pressed)]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.toggleLabel, { color: t.content }]}>{label}</Text>
        <Text style={[styles.toggleDetail, { color: t.contentMuted }]}>{detail}</Text>
      </View>
      <Switch value={value} onValueChange={flip} trackColor={{ true: t.brand }} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/** A page inside a sheet: one choice from a list, Cancel back to the form. */
export function ChoicePage({
  title,
  options,
  value,
  onPick,
  onCancel,
}: {
  title: string;
  options: Array<{ value: string; label: string; detail?: string; section?: string }>;
  value: string;
  onPick: (v: string) => void;
  onCancel: () => void;
}) {
  const sections: Array<{ title?: string; items: typeof options }> = [];
  for (const o of options) {
    const last = sections[sections.length - 1];
    if (last && last.title === o.section) last.items.push(o);
    else sections.push({ title: o.section, items: [o] });
  }
  return (
    <>
      <SheetBar title={title} left={{ title: "Cancel", onPress: onCancel }} />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
        {sections.map((s, si) => (
          <View key={si} style={formStyles.section}>
            {s.title ? <SectionHeader>{s.title}</SectionHeader> : null}
            <Group>
              {s.items.map((o, i) => (
                <View key={o.value}>
                  {i > 0 ? <Divider /> : null}
                  <CheckRow
                    label={o.label}
                    detail={o.detail}
                    checked={o.value === value}
                    onPress={() => {
                      Haptics.selectionAsync();
                      onPick(o.value);
                    }}
                  />
                </View>
              ))}
            </Group>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

export type PickedAddress = { address: string; placeId: string; lat: number | null; lng: number | null };

/**
 * An address with suggestions from the API's Google Places proxy, as the web's
 * AddressAutocomplete: typing clears the resolved place, picking a suggestion
 * fills it, and a business address is refused.
 */
export function AddressField({ value, onText, onPick, rejected, onReject }: { value: string; onText: (v: string) => void; onPick: (p: PickedAddress) => void; rejected: boolean; onReject: () => void }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ description: string; placeId: string }>>([]);
  const [resolving, setResolving] = useState(false);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || !focused || value.trim().length < 3) return setSuggestions([]);
    let live = true;
    const id = setTimeout(() => {
      accountsApi
        .placesAutocomplete(value.trim())
        .then((r) => live && setSuggestions(r.predictions.slice(0, 5)))
        .catch(() => live && setSuggestions([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [value, focused]);

  const pick = async (s: { description: string; placeId: string }) => {
    Haptics.selectionAsync();
    typed.current = false;
    setSuggestions([]);
    setResolving(true);
    try {
      const d = await accountsApi.placeDetails(s.placeId);
      if (d.isBusiness) onReject();
      else onPick({ address: d.address ?? s.description, placeId: d.placeId, lat: d.lat, lng: d.lng });
    } catch {
      onPick({ address: s.description, placeId: s.placeId, lat: null, lng: null });
    } finally {
      setResolving(false);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Group>
        <View style={styles.addressRow}>
          <TextInput
            value={value}
            onChangeText={(v) => {
              typed.current = true;
              onText(v);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Street address"
            placeholderTextColor={t.contentFaint}
            keyboardAppearance={t.keyboard}
            selectionColor={t.brandInk}
            autoCorrect={false}
            textContentType="fullStreetAddress"
            returnKeyType="done"
            clearButtonMode="while-editing"
            accessibilityLabel="Address"
            style={[styles.addressInput, { color: t.content }]}
          />
          {resolving ? <ActivityIndicator /> : null}
        </View>
        {suggestions.map((s) => (
          <View key={s.placeId}>
            <Divider />
            <Pressable
              onPress={() => void pick(s)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${s.description}`}
              style={({ pressed }) => [styles.suggestion, pressFeedback(t, pressed)]}
            >
              <SymbolView name="mappin.and.ellipse" size={icon.sm} tintColor={t.contentMuted} accessibilityElementsHidden importantForAccessibility="no" />
              <Text style={[styles.suggestionText, { color: t.content }]} numberOfLines={2}>
                {s.description}
              </Text>
            </Pressable>
          </View>
        ))}
      </Group>
      {rejected ? <Text style={[formStyles.footnote, { color: t.negative }]}>Commercial properties aren't supported. Enter a home address.</Text> : null}
    </View>
  );
}

/** Market estimate or the person's own value, with the value field under "My own value". */
export function ValueSourceSection({
  source,
  onSource,
  ownValue,
  onOwnValue,
}: {
  source: "market" | "own";
  onSource: (s: "market" | "own") => void;
  ownValue: string;
  onOwnValue: (v: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={formStyles.section}>
      <SectionHeader>Value</SectionHeader>
      <Segmented
        accessibilityLabel="Value source"
        value={source}
        onChange={(v) => {
          Haptics.selectionAsync();
          onSource(v);
        }}
        options={[
          { value: "market", label: "Market estimate" },
          { value: "own", label: "My own value" },
        ]}
      />
      {source === "own" ? (
        <Group>
          <InputRow label="Your value" value={ownValue} onChange={(v) => onOwnValue(v.replace(/[^0-9.]/g, ""))} placeholder="0" keyboardType="decimal-pad" />
        </Group>
      ) : null}
      <Text style={[formStyles.footnote, { color: t.contentMuted }]}>
        {source === "own" ? "We'll use this value and won't overwrite it with an estimate." : "We estimate the value from the address and keep it up to date."}
      </Text>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    add: { minHeight: 44, justifyContent: "center" },
    addText: { ...type.body },
    toggle: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.rowInset, paddingVertical: 10, minHeight: 56 },
    toggleLabel: { ...type.body },
    toggleDetail: { ...type.footnote },
    addressRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: space.rowInset },
    addressInput: { ...inputType, flex: 1, minHeight: 48 },
    suggestion: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space.rowInset, paddingVertical: 12, minHeight: 48 },
    suggestionText: { ...type.callout, ...weight.medium, flex: 1 },
  }),
);
