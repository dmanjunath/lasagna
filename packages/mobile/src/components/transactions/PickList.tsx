import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { CheckRow, Divider, formStyles, Group, SectionHeader } from "@/ui/Form";
import { SearchField, SelectAllRow } from "@/ui/SearchField";

export type PickItem = { id: string; label: string; detail?: string; value?: string; group?: string };

/**
 * A multi-select list for the filter sheet: a search, Select all and Select
 * none (over the rows the search shows), an "All" row that means no filter,
 * then the rows by group. An empty selection is no filter. `onQuery` hands the
 * search to the caller instead of narrowing here (merchants search the server).
 */
export function PickList({
  items,
  selected,
  onChange,
  allLabel,
  searchPlaceholder,
  onQuery,
  footer,
}: {
  items: PickItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
  searchPlaceholder: string;
  onQuery?: (q: string) => void;
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (onQuery || !q ? items : items.filter((i) => `${i.label} ${i.detail ?? ""} ${i.group ?? ""}`.toLowerCase().includes(q))),
    [items, q, onQuery],
  );
  const groups = useMemo(() => {
    const out: Array<{ title: string | undefined; items: PickItem[] }> = [];
    for (const i of shown) {
      const last = out[out.length - 1];
      if (last && last.title === i.group) last.items.push(i);
      else out.push({ title: i.group, items: [i] });
    }
    return out;
  }, [shown]);
  const shownIds = shown.map((i) => i.id);
  const allIds = items.map((i) => i.id);
  // Every row ticked is the same as no filter when nothing narrows the rows: store that, so it shows no chips.
  const normalize = (ids: string[]) => (!onQuery && !q && ids.length === allIds.length && allIds.every((id) => ids.includes(id)) ? [] : ids);
  const tap = (id: string) => {
    Haptics.selectionAsync();
    onChange(normalize(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]));
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={formStyles.section}>
        <SearchField
          value={query}
          onChange={(v) => {
            setQuery(v);
            onQuery?.(v);
          }}
          placeholder={searchPlaceholder}
        />
        <SelectAllRow
          allDisabled={shownIds.length === 0 || shownIds.every((id) => selected.includes(id))}
          noneDisabled={selected.length === 0}
          onAll={() => onChange(normalize([...new Set([...selected, ...shownIds])]))}
          // Only the shown rows while a search narrows them, everything otherwise.
          onNone={() => onChange(q ? selected.filter((id) => !shownIds.includes(id)) : [])}
        />
      </View>
      {q ? null : (
        <Group>
          <CheckRow label={allLabel} checked={selected.length === 0} onPress={() => onChange([])} />
        </Group>
      )}
      {groups.map((g, gi) => (
        <View key={`${g.title ?? ""}-${gi}`} style={formStyles.section}>
          {g.title ? <SectionHeader>{g.title}</SectionHeader> : null}
          <Group>
            {g.items.map((i, k) => (
              <View key={i.id}>
                {k > 0 ? <Divider /> : null}
                <CheckRow label={i.label} detail={i.detail} value={i.value} checked={selected.includes(i.id)} onPress={() => tap(i.id)} />
              </View>
            ))}
          </Group>
        </View>
      ))}
      {footer}
    </ScrollView>
  );
}
