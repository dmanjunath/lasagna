import * as Haptics from "expo-haptics";
import { Fragment } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { SwitchRow } from "@/components/profile/SettingsParts";
import { useDesignPicker } from "@/design";
import { setAppearanceMode, useAppearanceMode, type AppearanceMode } from "@/lib/appearance";
import { setAmountsHidden, useAmountsHidden } from "@/lib/hide-amounts";
import { themedStyles } from "@/theme";
import { Card } from "@/ui/Card";
import { CheckRow, Divider, SectionHeader } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";

const MODES: Array<{ value: AppearanceMode; label: string; detail?: string }> = [
  { value: "auto", label: "Automatic", detail: "Matches your iPhone" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * How the app looks on this device (Settings.tsx Display): light or dark,
 * hide amounts, and the Design picker for admins and dev builds. Push
 * notifications are not offered: this app has no push yet, as the web shows
 * that section only where the shell can deliver one.
 */
export default function PreferencesScreen() {
  const { user } = useAuth();
  const mode = useAppearanceMode();
  const hidden = useAmountsHidden();
  const picker = useDesignPicker();
  const showDesign = !!user?.isAdmin || __DEV__;
  return (
    <ScreenScroll title="Preferences">
      <View style={styles.section}>
        <SectionHeader>Appearance</SectionHeader>
        <Card style={styles.listCard}>
          {MODES.map((m, i) => (
            <Fragment key={m.value}>
              {i > 0 ? <Divider /> : null}
              <CheckRow
                label={m.label}
                detail={m.detail}
                checked={mode === m.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  setAppearanceMode(m.value);
                }}
              />
            </Fragment>
          ))}
        </Card>
      </View>

      <Card style={styles.switchCard}>
        <SwitchRow title="Hide amounts" detail="Replace dollar amounts with dots so nothing shows on a shared screen." value={hidden} onChange={setAmountsHidden} />
      </Card>

      {showDesign ? (
        <View style={styles.section}>
          <SectionHeader>Design</SectionHeader>
          <Card style={styles.listCard}>
            {picker.themes.map((d, i) => (
              <Fragment key={d.id}>
                {i > 0 ? <Divider /> : null}
                <CheckRow
                  label={d.name}
                  checked={picker.activeId === d.id}
                  onPress={() => {
                    if (picker.activeId === d.id) return;
                    Haptics.selectionAsync();
                    picker.setDesign(d.id);
                  }}
                />
              </Fragment>
            ))}
          </Card>
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    section: { gap: 6 },
    listCard: { padding: 0 },
    switchCard: { padding: 0, paddingVertical: 4 },
  }),
);
