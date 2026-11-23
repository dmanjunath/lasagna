import { Stack } from "expo-router";
import { openPath } from "@/lib/navigation";
import { useDrawer } from "./Drawer";

// The nav bar's shared items (see the page chrome contract): the hamburger
// leading on a tab's root, and Home's avatar trailing. Every other
// trailing item is the screen's own verb. Hide amounts is not in the bar: a
// tap on a hero amount, or the switch in Settings, toggles it.

/** The hamburger, leading on every tab's root screen (as the web's AppHeader shows it on main pages). */
export function MenuButton() {
  const drawer = useDrawer();
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button icon="line.3.horizontal" accessibilityLabel="Open menu" onPress={drawer.open} />
    </Stack.Toolbar>
  );
}

/** Home's trailing avatar: Profile & Settings, which holds Admin and Sign out. */
export function AccountButton() {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="person.crop.circle" accessibilityLabel="Profile and settings" onPress={() => openPath("/profile")} />
    </Stack.Toolbar>
  );
}
