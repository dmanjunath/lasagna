import { useQuery } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";
import { SymbolView } from "expo-symbols";
import { Fragment, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { securityApi, type Passkey } from "@/api/profile";
import { useAuth } from "@/auth/AuthProvider";
import { isLockEnabled, setLockEnabled, setSetupPrompted } from "@/auth/biometric";
import { setPasskeyRegistered } from "@/auth/passkey";
import { isPasskeyCancel, registerPasskey } from "@/auth/passkey-flows";
import { RoleTile, SwitchRow } from "@/components/profile/SettingsParts";
import { pushInTab } from "@/lib/navigation";
import { exactTime } from "@/lib/profile";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { committed, failed } from "@/ui/feedback";
import { Divider, formStyles } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { DEMO_BUILD } from "../ProfileScreen";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Security (Settings.tsx): the password, the passkeys that sign in with Face
 * ID, and the Face ID lock on opening the app, which is also the way to turn
 * the lock off.
 */
export default function SecurityScreen() {
  const passkeys = useQuery({ queryKey: ["passkeys"], queryFn: securityApi.passkeys });
  // Keep sign-in's "Sign in with Face ID" offer in step with what the account actually has.
  const count = passkeys.data?.credentials.length;
  useEffect(() => {
    if (count !== undefined) setPasskeyRegistered(count > 0);
  }, [count]);
  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await passkeys.refetch();
    } finally {
      setPulling(false);
    }
  };
  return (
    <ScreenScroll title="Security" refreshing={pulling} onRefresh={() => void onPull()}>
      {!DEMO_BUILD ? <PasswordCard /> : null}
      <PasskeysCard passkeys={passkeys} />
      <FaceIdLockCard />
    </ScreenScroll>
  );
}

function PasswordCard() {
  const t = useTheme();
  const { user } = useAuth();
  if (!user) return null;
  const has = !!user.hasPassword;
  const last = exactTime(user.lastLoginAt);
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <RoleTile symbol="key" role="neutral" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.title, { color: t.content }]} accessibilityRole="header">
            Password
          </Text>
          <Text style={[styles.body, { color: t.contentMuted }]}>{has ? "A password is set for your account." : "No password. You sign in with an emailed code."}</Text>
          {last ? <Text style={[styles.body, { color: t.contentMuted }]}>{`Last signed in ${last}`}</Text> : null}
        </View>
      </View>
      <Button title={has ? "Change password" : "Set password"} variant="tinted" size="compact" style={styles.action} onPress={() => pushInTab("/set-password")} />
    </Card>
  );
}

function PasskeysCard({ passkeys }: { passkeys: ReturnType<typeof useQuery<{ credentials: Passkey[] }>> }) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const creds = passkeys.data?.credentials ?? [];

  const add = async () => {
    setAdding(true);
    setError("");
    try {
      await registerPasskey();
    } catch (e) {
      // Dismissing the system sheet is not a failure.
      if (!isPasskeyCancel(e)) setError("Couldn't add a passkey on this iPhone. Try again.");
      return;
    } finally {
      setAdding(false);
    }
    await passkeys.refetch();
    committed("Passkey added");
  };

  const remove = (c: Passkey) =>
    Alert.alert("Remove this passkey?", "You won't be able to sign in with it anymore. You can add it again anytime.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await securityApi.removePasskey(c.id);
          } catch {
            failed("Couldn't remove this passkey. Try again.");
            return;
          }
          await passkeys.refetch();
          committed("Passkey removed");
        },
      },
    ]);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <RoleTile symbol="faceid" role="neutral" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.title, { color: t.content }]} accessibilityRole="header">
            Face ID and passkeys
          </Text>
          <Text style={[styles.body, { color: t.contentMuted }]}>Skip the password on devices you trust.</Text>
        </View>
      </View>
      {passkeys.isPending ? (
        <Skeleton height={44} />
      ) : creds.length > 0 ? (
        <View>
          {creds.map((c) => (
            <Fragment key={c.id}>
              <Divider inset={0} />
              <View style={styles.passkey}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.rowTitle, { color: t.content }]} numberOfLines={1}>
                    {c.deviceName || "Passkey"}
                  </Text>
                  <Text style={[styles.body, { color: t.contentMuted }]}>{`Added ${shortDate(c.createdAt)}${c.lastUsedAt ? `, last used ${shortDate(c.lastUsedAt)}` : ""}`}</Text>
                </View>
                <Pressable onPress={() => remove(c)} accessibilityRole="button" accessibilityLabel={`Remove ${c.deviceName || "passkey"}`} hitSlop={10} style={styles.trash}>
                  <SymbolView name="trash" size={icon.md} tintColor={t.negative} accessibilityElementsHidden importantForAccessibility="no" />
                </Pressable>
              </View>
            </Fragment>
          ))}
        </View>
      ) : (
        <Text style={[styles.body, { color: t.contentMuted }]}>No passkeys yet. Add one to sign in with Face ID on this iPhone.</Text>
      )}
      {error ? <Text style={[formStyles.error, { color: t.negative, paddingHorizontal: 0 }]}>{error}</Text> : null}
      <Button title="Add passkey" variant="tinted" size="compact" icon="plus" iconLeading loading={adding} style={styles.action} onPress={() => void add()} />
    </Card>
  );
}

/** The app lock. Turning it on proves Face ID works first, so a broken sensor can never lock anyone out. */
function FaceIdLockCard() {
  const t = useTheme();
  const [enabled, setEnabled] = useState(isLockEnabled);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
      .then(([hw, enrolled]) => live && setAvailable(hw && enrolled))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (on: boolean) => {
    setError("");
    if (!on) {
      setLockEnabled(false);
      setEnabled(false);
      return;
    }
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Turn on Face ID lock", disableDeviceFallback: false });
    if (!r.success) {
      if (r.error !== "user_cancel" && r.error !== "app_cancel" && r.error !== "system_cancel") setError("Face ID didn't confirm. Try again.");
      return;
    }
    setLockEnabled(true);
    // Asked and answered: the one-time offer after sign-in has nothing left to offer.
    setSetupPrompted(true);
    setEnabled(true);
  };

  return (
    <Card style={[styles.card, styles.switchCard]}>
      <SwitchRow
        symbol="lock"
        title="Face ID lock"
        detail={available === false && !enabled ? "Face ID isn't set up on this iPhone." : "Require Face ID when you open the app."}
        value={enabled}
        disabled={available === null || (available === false && !enabled)}
        onChange={(v) => void toggle(v)}
      />
      {error ? <Text style={[formStyles.error, { color: t.negative, paddingHorizontal: space.rowInset }]}>{error}</Text> : null}
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { gap: 12 },
    switchCard: { padding: 0, paddingVertical: 4 },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    title: { ...type.headline },
    body: { ...type.footnote },
    rowTitle: { ...type.callout, ...weight.semibold },
    action: { alignSelf: "flex-start" },
    passkey: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
    trash: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  }),
);
