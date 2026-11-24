import { Stack } from "expo-router";
import { useColorScheme } from "react-native";
import type { TabGroup } from "@/lib/routes";
import { TabContext } from "@/shell/tab-context";
import { font, useTheme } from "@/theme";

// A link that opens a pushed screen still has the tab's root beneath it to go back to.
export const unstable_settings = { anchor: "index" };

/** iOS 26 rounds sheets to the display's corners, which crowds the sheet bar's Cancel and verb. A smaller radius keeps them clear. */
const SHEET_RADIUS = 24;

/**
 * Each tab's own stack, so a push stays in its tab. The five tabs share these
 * screens. Headers (the page chrome contract): no large titles. A native
 * screen's title scrolls with its content under a slim bar, a web page has a
 * plain inline bar, a sheet its SheetBar.
 */
export default function TabStack({ segment }: { segment: string }) {
  const t = useTheme();
  const dark = useColorScheme() === "dark";
  const home = segment === "(home)";
  return (
    <TabContext.Provider value={segment as TabGroup}>
      <Stack
        screenOptions={{
          headerTintColor: t.brandInk,
          headerTitleStyle: { color: t.content, fontFamily: font.semibold },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: t.canvas },
          contentStyle: { backgroundColor: t.canvas },
          headerBackButtonDisplayMode: "minimal",
          // The bar (and its search field's keyboard) follows the scheme, not the navigation theme's default light.
          headerUserInterfaceStyle: dark ? "dark" : "light",
        }}
      >
        {/* Native screens draw their own title in their content and drive a slim bar (ui/ScreenScroll). A web page keeps a plain inline bar. */}
        <Stack.Screen name="index" options={{ title: home ? "Home" : "" }} />
        <Stack.Screen name="transactions" options={{ title: "Transactions" }} />
        <Stack.Screen name="spending" options={{ title: "Spending" }} />
        <Stack.Screen name="insights" options={{ title: "Actions" }} />
        <Stack.Screen name="accounts/index" options={{ title: "Accounts" }} />
        <Stack.Screen name="accounts/[id]" options={{ title: "" }} />
        <Stack.Screen name="goals/index" options={{ title: "Goals" }} />
        <Stack.Screen name="goals/[id]" options={{ title: "" }} />
        <Stack.Screen name="financial-level/index" options={{ title: "Financial journey" }} />
        <Stack.Screen name="financial-level/[step]" options={{ title: "" }} />
        <Stack.Screen name="profile/index" options={{ title: "Profile" }} />
        <Stack.Screen name="profile/[section]" options={{ title: "" }} />
        <Stack.Screen name="chat/index" options={{ title: "" }} />
        <Stack.Screen name="chat/[id]" options={{ title: "" }} />
        <Stack.Screen name="debt" options={{ title: "Debt" }} />
        <Stack.Screen name="portfolio" options={{ title: "Portfolio" }} />
        <Stack.Screen name="tax" options={{ title: "Tax" }} />
        <Stack.Screen name="web/[...path]" options={{ title: "" }} />
        <Stack.Screen
          name="transaction/[id]"
          options={{
            presentation: "formSheet",
            headerShown: false,
            sheetAllowedDetents: [0.75, 1],
            sheetGrabberVisible: true,
            sheetCornerRadius: SHEET_RADIUS,
            contentStyle: { backgroundColor: t.canvas },
          }}
        />
        {["transaction-filters", "transaction-rule", "pick-category", "add-account", "account-edit", "goal-form", "profile-edit", "set-password", "household-invite", "delete-account", "journey-why", "holding", "tax-add", "tax-document"].map((name) => (
          <Stack.Screen
            key={name}
            name={name}
            options={({ route }) => ({
              presentation: "formSheet",
              headerShown: false,
              // The filter sheet is a stack of grouped sections, so it opens full height, except for a page
              // with one or two of them (openFilters' ?compact=1), which opens at half and can still grow.
              sheetAllowedDetents:
                name === "transaction-filters"
                  ? (route.params as { compact?: string } | undefined)?.compact
                    ? [0.5, 1]
                    : [1]
                  : name === "journey-why" || name === "holding"
                    ? [0.6, 1]
                    : [0.75, 1],
              sheetGrabberVisible: true,
              sheetCornerRadius: SHEET_RADIUS,
              contentStyle: { backgroundColor: t.canvas },
            })}
          />
        ))}
      </Stack>
    </TabContext.Provider>
  );
}
