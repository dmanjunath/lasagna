import { useGlobalSearchParams, useSegments } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect } from "react";
import { Platform } from "react-native";
import { FaceIdSetupPrompt } from "@/auth/FaceIdSetupPrompt";
import { openPath, takePendingPath } from "@/lib/navigation";
import { isSheetOnTop, setCurrentTab, setSheetOpen, TABS, webPathFor } from "@/lib/routes";
import { paintWindows } from "@/design/ThemeProvider";
import { DrawerShell } from "@/shell/Drawer";
import { DrawerMenu } from "@/shell/DrawerMenu";
import { useTabBarHidden } from "@/shell/tab-bar";
import { BULK_BAR_HEIGHT } from "@/components/transactions/BulkBar";
import { setToastLift } from "@/ui/Toast";

/** The system tab bar's height above the home indicator. */
const TAB_BAR_HEIGHT = 49;
import { font, useTheme } from "@/theme";

const ios17 = Number(Platform.Version) >= 17;

// The web tab bar's icons (lucide LayoutDashboard, Wallet, CreditCard, Target,
// MessageSquare) as SF Symbols, outlined at rest and filled when selected.
const ICONS = {
  "(home)": { default: "square.grid.2x2", selected: "square.grid.2x2.fill" },
  "(accounts)": ios17 ? ({ default: "wallet.bifold", selected: "wallet.bifold.fill" } as const) : ({ default: "wallet.pass", selected: "wallet.pass.fill" } as const),
  "(spending)": { default: "creditcard", selected: "creditcard.fill" },
  "(goals)": { default: "target", selected: "target" },
  "(chat)": { default: "bubble.left", selected: "bubble.left.fill" },
} as const;

export default function AppLayout() {
  const t = useTheme();
  const segments = useSegments() as string[];
  const { path } = useGlobalSearchParams<{ path?: string | string[] }>();
  // segments: ["(app)", "(tab)", ...screen]. Only a tab's root opens the drawer from the edge.
  const atTabRoot = segments.length <= 2;
  const activePath = webPathFor(segments, path);
  const tabBarHidden = useTabBarHidden();

  useEffect(() => {
    setCurrentTab(segments[1]);
    setSheetOpen(isSheetOnTop(segments));
  }, [segments]);

  // Toasts float above whichever bar holds the screen's foot: the tab bar, or
  // the selection's toolbar that takes its place.
  useEffect(() => {
    setToastLift(tabBarHidden ? BULK_BAR_HEIGHT : TAB_BAR_HEIGHT);
  }, [tabBarHidden]);
  useEffect(() => () => setToastLift(0), []);

  // The tabs and their stacks start in UIKit's light default: paint them in the canvas once they exist,
  // or their corners show light behind a page or tab moving on iOS 26.
  useEffect(() => {
    const id = setTimeout(paintWindows, 0);
    return () => clearTimeout(id);
  }, []);

  // A destination chosen before the app was showing (onboarding's last step).
  useEffect(() => {
    const pending = takePendingPath();
    if (pending) setTimeout(() => openPath(pending, "tab"), 0);
  }, []);

  return (
    <DrawerShell edgeSwipe={atTabRoot} panel={(close) => <DrawerMenu activePath={activePath} close={close} />}>
      <NativeTabs
        tintColor={t.brandInk}
        iconColor={{ default: t.contentMuted, selected: t.brandInk }}
        labelStyle={{ default: { fontFamily: font.semibold, color: t.contentMuted }, selected: { fontFamily: font.bold, color: t.brandInk } }}
        backgroundColor={t.canvas}
        shadowColor={t.hairline}
        hidden={tabBarHidden}
      >
        {TABS.map((tab) => {
          const title = tab.title;
          return (
          <NativeTabs.Trigger key={tab.group} name={tab.group} accessibilityLabel={title} disableTransparentOnScrollEdge>
            <NativeTabs.Trigger.Label>{title}</NativeTabs.Trigger.Label>
            <NativeTabs.Trigger.Icon sf={ICONS[tab.group]} />
          </NativeTabs.Trigger>
          );
        })}
      </NativeTabs>
      <FaceIdSetupPrompt />
    </DrawerShell>
  );
}
