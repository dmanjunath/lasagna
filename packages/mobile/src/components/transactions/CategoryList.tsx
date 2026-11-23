import { useState } from "react";
import { ScrollView, View } from "react-native";
import { pickerGroups } from "@/lib/txn-filters";
import { useTaxonomy } from "@/lib/taxonomy";
import * as Haptics from "expo-haptics";
import { CheckRow, Divider, formStyles, Group, SectionHeader, SheetBar } from "@/ui/Form";
import { Skeleton } from "@/ui/Skeleton";
import { SearchField, SelectAllRow } from "@/ui/SearchField";
import { ErrorState } from "@/ui/State";

type Single = { multiple?: false; value: string; onPick: (id: string) => void; anyLabel?: string };
/** `allLabel`: the row for an empty selection ("All categories"), when empty means every category. */
type Multi = { multiple: true; selected: string[]; onChange: (ids: string[]) => void; allLabel?: string; header?: React.ReactNode };

/**
 * Every enabled category, grouped as the taxonomy groups them. Single mode
 * ticks the current one and picks on tap. Multi mode adds a group row that is
 * checked when every child is, mixed when some are, and selects the whole
 * group when tapped while partial (partial, all, none, all), as the web does.
 */
export function CategoryList(props: Single | Multi) {
  const { data, isPending, isError, refetch } = useTaxonomy();
  const [query, setQuery] = useState("");
  if (isPending) return <ListSkeleton />;
  if (isError) return <ErrorState title="Categories didn't load" onRetry={() => void refetch()} />;
  const q = query.trim().toLowerCase();
  // A search keeps a group whose name matches whole, else only its matching categories.
  const groups = pickerGroups(data.groups)
    .map((g) => (!q || g.name.toLowerCase().includes(q) ? g : { ...g, categories: g.categories.filter((c) => c.name.toLowerCase().includes(q)) }))
    .filter((g) => g.categories.length > 0);
  const shownIds = groups.flatMap((g) => g.categories.map((c) => c.id));

  return (
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {props.multiple ? props.header : null}
      {props.multiple ? (
        <View style={formStyles.section}>
          <SearchField value={query} onChange={setQuery} placeholder="Search categories" />
          <SelectAllRow
            allDisabled={shownIds.length === 0 || shownIds.every((id) => props.selected.includes(id))}
            noneDisabled={props.selected.length === 0}
            // Where empty means every category, Select all with nothing searched is that same All.
            onAll={() => props.onChange(props.allLabel && !q ? [] : [...new Set([...props.selected, ...shownIds])])}
            onNone={() => props.onChange(q ? props.selected.filter((id) => !shownIds.includes(id)) : [])}
          />
        </View>
      ) : null}
      {props.multiple && props.allLabel && !q ? (
        <Group>
          <CheckRow label={props.allLabel} checked={props.selected.length === 0} onPress={() => props.onChange([])} />
        </Group>
      ) : null}
      {!props.multiple && props.anyLabel ? (
        <Group>
          <CheckRow label={props.anyLabel} checked={props.value === ""} onPress={() => props.onPick("")} />
        </Group>
      ) : null}
      {groups.map((g) => {
        const ids = g.categories.map((c) => c.id);
        const picked = props.multiple ? ids.filter((id) => props.selected.includes(id)) : [];
        const all = !!props.multiple && picked.length === ids.length;
        const some = props.multiple && picked.length > 0 && !all;
        return (
          <View key={g.id} style={formStyles.section}>
            <SectionHeader>{g.name}</SectionHeader>
            <Group>
              {props.multiple && ids.length > 1 ? (
                <>
                  <CheckRow
                    label={`All of ${g.name}`}
                    strong
                    checked={all}
                    mixed={some}
                    onPress={() =>
                      props.onChange(all ? props.selected.filter((id) => !ids.includes(id)) : [...props.selected.filter((id) => !ids.includes(id)), ...ids])
                    }
                  />
                  <Divider />
                </>
              ) : null}
              {g.categories.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Divider /> : null}
                  <CheckRow
                    label={c.name}
                    checked={props.multiple ? props.selected.includes(c.id) : props.value === c.id}
                    onPress={() => {
                      if (!props.multiple) return props.onPick(c.id);
                      props.onChange(props.selected.includes(c.id) ? props.selected.filter((id) => id !== c.id) : [...props.selected, c.id]);
                    }}
                  />
                </View>
              ))}
            </Group>
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * The one category picker: Cancel on the left, the request's title, the
 * grouped list. The pick-category sheet shows it, and a sheet that already
 * holds edits (the detail, a new rule) shows it as its own page, since a sheet
 * cannot be stacked on a sheet. Same header and behavior everywhere.
 */
export function CategoryPickerPage({
  title,
  value,
  anyLabel,
  onPick,
  onCancel,
}: {
  title: string;
  value: string;
  anyLabel?: string;
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <SheetBar title={title} left={{ title: "Cancel", onPress: onCancel }} />
      <CategoryList
        value={value}
        anyLabel={anyLabel}
        onPick={(id) => {
          Haptics.selectionAsync();
          onPick(id);
        }}
      />
    </>
  );
}

/** A grouped list's outline while it loads. */
export function ListSkeleton() {
  return (
    <View style={formStyles.body} accessibilityLabel="Loading" accessible>
      {[4, 3].map((rows, i) => (
        <View key={i} style={formStyles.section}>
          <Skeleton width={120} height={13} style={{ marginHorizontal: 16 }} />
          <Group>
            {Array.from({ length: rows }, (_, j) => (
              <View key={j}>
                {j > 0 ? <Divider /> : null}
                <View style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 16 }}>
                  <Skeleton width={j % 2 ? "55%" : "40%"} height={14} />
                </View>
              </View>
            ))}
          </Group>
        </View>
      ))}
    </View>
  );
}
