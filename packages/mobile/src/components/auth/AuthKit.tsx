import * as WebBrowser from "expo-web-browser";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { icon, radius, space, themedStyles, type, useTheme, weight } from "@/theme";
import { BrandLockup } from "@/ui/BrandMark";
import { TextLink } from "@/ui/Card";
import { FitScrollView } from "@/ui/FitScrollView";
import { Mascot } from "@/ui/Mascot";
import { useTheme as useDesign } from "@/design";
import { hideSplashOnce } from "@/lib/splash";

export { TextLink };

/** A signed-out screen: the brand, a heading and a form, in one centred column. It scrolls only when the keyboard leaves it too little room. */
export function AuthLayout({
  title,
  subtitle,
  mark = "lockup",
  children,
  footer,
}: {
  title?: string;
  subtitle?: ReactNode;
  /**
   * Every auth screen opens with the same header: the lockup, then the title
   * and subtitle. `mascot` adds the theme's happy mascot under the lockup for
   * a celebration. `none` is for a screen inside a flow that already showed it.
   */
  mark?: "lockup" | "mark" | "mascot" | "none";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTheme();
  const d = useDesign();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }} onLayout={hideSplashOnce}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <FitScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.head}>
            {mark !== "none" ? <BrandLockup size={40} large /> : null}
            {mark === "mascot" && d.mascot ? (
              <View style={{ marginTop: 8 }}>
                <Mascot name="happy" width={132} />
              </View>
            ) : null}
            {title ? (
              <Text style={[styles.title, { color: t.content }]} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {subtitle ? <Text style={[styles.subtitle, { color: t.contentSecondary }]}>{subtitle}</Text> : null}
          </View>
          <View style={styles.form}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </FitScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** An error or notice above a form's button (the web's uikit Alert). */
export function Banner({ tone = "negative", children, action }: { tone?: "negative" | "neutral"; children: ReactNode; action?: { title: string; onPress: () => void } }) {
  const t = useTheme();
  const negative = tone === "negative";
  return (
    <View
      accessibilityRole={negative ? "alert" : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: negative ? t.negativeSoft : t.canvasSunken, borderColor: negative ? "transparent" : t.line }]}
    >
      <Text style={[styles.bannerText, { color: negative ? t.negative : t.contentSecondary }]}>{children}</Text>
      {action ? <TextLink title={action.title} onPress={action.onPress} /> : null}
    </View>
  );
}

/** "or" between the form and the other ways in. */
export function OrDivider() {
  const t = useTheme();
  return (
    <View style={styles.or} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.orRule, { backgroundColor: t.line }]} />
      <Text style={[styles.orText, { color: t.contentMuted }]}>or</Text>
      <View style={[styles.orRule, { backgroundColor: t.line }]} />
    </View>
  );
}

// The public legal pages packages/web/src/components/common/ConsentCheckboxes.tsx links to.
const LEGAL = { terms: "https://lasagnafi.com/terms", privacy: "https://lasagnafi.com/privacy" };

export type ConsentValues = { acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean };
export const NO_CONSENT: ConsentValues = { acceptedTos: false, acceptedPrivacy: false, acceptedNotRia: false };
export const allConsented = (v: ConsentValues) => v.acceptedTos && v.acceptedPrivacy && v.acceptedNotRia;

/** The three sign-up agreements. Each link opens in an in-app Safari sheet. */
export function ConsentCheckboxes({ values, onChange }: { values: ConsentValues; onChange: (v: ConsentValues) => void }) {
  const t = useTheme();
  const link = (title: string, url: string) => (
    <Text
      style={{ color: t.brandInk, textDecorationLine: "underline" }}
      accessibilityRole="link"
      onPress={() => void WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET })}
    >
      {title}
    </Text>
  );
  return (
    <View>
      <ConsentRow checked={values.acceptedTos} label="I agree to the Terms of Service" onChange={(c) => onChange({ ...values, acceptedTos: c })}>
        I agree to the {link("Terms of Service", LEGAL.terms)}
      </ConsentRow>
      <ConsentRow checked={values.acceptedPrivacy} label="I agree to the Privacy Policy" onChange={(c) => onChange({ ...values, acceptedPrivacy: c })}>
        I agree to the {link("Privacy Policy", LEGAL.privacy)}
      </ConsentRow>
      <ConsentRow
        checked={values.acceptedNotRia}
        label="I understand that LasagnaFi is not a registered investment advisor and does not provide financial advice"
        onChange={(c) => onChange({ ...values, acceptedNotRia: c })}
      >
        I understand that LasagnaFi is <Text style={[weight.semibold, { color: t.content }]}>not a registered investment advisor</Text> and does not provide
        financial advice
      </ConsentRow>
    </View>
  );
}

function ConsentRow({ checked, onChange, label, children }: { checked: boolean; onChange: (c: boolean) => void; label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.consentRow}>
      <Pressable
        onPress={() => onChange(!checked)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
        style={[styles.box, checked ? { backgroundColor: t.brand, borderColor: t.brand } : { backgroundColor: t.panel, borderColor: t.lineStrong }]}
      >
        {checked ? <SymbolView name="checkmark" size={icon.sm} weight="heavy" tintColor={t.brandFg} accessibilityElementsHidden importantForAccessibility="no" /> : null}
      </Pressable>
      <Text style={[styles.consentText, { color: t.contentSecondary }]} onPress={() => onChange(!checked)}>
        {children}
      </Text>
    </View>
  );
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

const styles = themedStyles(() => StyleSheet.create({
  // No cards here: the fields sit where a card's content would, the theme's gutter plus card padding from the edge.
  body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: space.screen + space.card, paddingVertical: 32, gap: 24 },
  head: { alignItems: "center", gap: 8 },
  title: { ...type.title1, textAlign: "center", marginTop: 12 },
  subtitle: { ...type.subhead, textAlign: "center" },
  form: { gap: 14 },
  footer: { alignItems: "center", gap: 12 },
  banner: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  bannerText: { ...type.subhead },
  or: { flexDirection: "row", alignItems: "center", gap: 12 },
  orRule: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { ...type.footnote },
  consentRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
  box: { width: 22, height: 22, borderRadius: radius.xs, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  consentText: { ...type.subhead, flex: 1 },
}));
