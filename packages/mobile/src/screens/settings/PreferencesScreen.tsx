import * as Haptics from "expo-haptics";
import { Fragment, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { SwitchRow } from "@/components/profile/SettingsParts";
import { useDesignPicker } from "@/design";
import { setAppearanceMode, useAppearanceMode, type AppearanceMode } from "@/lib/appearance";
import { setAmountsHidden, useAmountsHidden } from "@/lib/hide-amounts";
import { getPushState, pushAvailable, setPushEnabled, type PushState } from "@/lib/push";
import { themedStyles } from "@/theme";
import { Card } from "@/ui/Card";
import { CheckRow, Divider, SectionHeader } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { showToast } from "@/ui/Toast";

const MODES: Array<{ value: AppearanceMode; label: string; detail?: string }> = [
  { value: "auto", label: "Automatic", detail: "Matches your iPhone" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * How the app looks and behaves on this device (Settings.tsx Display and
 * Notifications): light or dark, hide amounts, push notifications (only in
 * builds that have push), and the Design picker for admins and dev builds.
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

      {pushAvailable() ? <PushSwitch /> : null}

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

/** This device's push notifications, as the web's Settings card does it. */
function PushSwitch() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getPushState().then(setState).catch(() => setState("off"));
  }, []);
  if (state === null) return null;
  return (
    <Card style={styles.switchCard}>
      <SwitchRow
        title="Push notifications"
        detail={state === "blocked" ? "Notifications are off for LasagnaFi in iOS. Turn them on in the Settings app." : null}
        value={state === "on"}
        disabled={busy || state === "blocked"}
        onChange={(on) => {
          setBusy(true);
          setPushEnabled(on)
            .then(setState)
            .catch(() => showToast({ title: "Couldn't update notifications. Try again.", tone: "negative" }))
            .finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    section: { gap: 6 },
    listCard: { padding: 0 },
    switchCard: { padding: 0, paddingVertical: 4 },
  }),
);
