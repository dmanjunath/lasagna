import { ScrollView, View } from "react-native";
import { groupAccounts, type AccountIndexEntry } from "@/lib/accounts";
import { CheckRow, Divider, formStyles, Group, SectionHeader } from "@/ui/Form";

type Single = { multiple?: false; value: string; onPick: (id: string) => void; anyLabel: string };
type Multi = { multiple: true; selected: string[]; onChange: (ids: string[]) => void };

/** Accounts grouped by type, each with its institution and mask, as the web's AccountPicker lists them. */
export function AccountList(props: (Single | Multi) & { accounts: AccountIndexEntry[] }) {
  const groups = groupAccounts(props.accounts);
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body}>
      <Group>
        <CheckRow
          label={props.multiple ? "All accounts" : props.anyLabel}
          checked={props.multiple ? props.selected.length === 0 : props.value === ""}
          onPress={() => (props.multiple ? props.onChange([]) : props.onPick(""))}
        />
      </Group>
      {groups.map((g) => (
        <View key={g.title} style={formStyles.section}>
          <SectionHeader>{g.title}</SectionHeader>
          <Group>
            {g.accounts.map((a, i) => (
              <View key={a.id}>
                {i > 0 ? <Divider /> : null}
                <CheckRow
                  label={a.name}
                  detail={`${a.institution}${a.mask ? ` ••${a.mask}` : ""}`}
                  checked={props.multiple ? props.selected.includes(a.id) : props.value === a.id}
                  onPress={() => {
                    if (!props.multiple) return props.onPick(a.id);
                    props.onChange(props.selected.includes(a.id) ? props.selected.filter((id) => id !== a.id) : [...props.selected, a.id]);
                  }}
                />
              </View>
            ))}
          </Group>
        </View>
      ))}
    </ScrollView>
  );
}
