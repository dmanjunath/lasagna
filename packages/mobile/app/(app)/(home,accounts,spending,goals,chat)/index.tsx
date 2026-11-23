import { useLocalSearchParams } from "expo-router";
import { useOwnTab } from "@/shell/tab-context";
import AccountsScreen from "@/screens/AccountsScreen";
import ChatScreen from "@/screens/ChatScreen";
import GoalsScreen from "@/screens/GoalsScreen";
import HomeScreen from "@/screens/HomeScreen";
import SpendingScreen from "@/screens/SpendingScreen";

/** A tab's root: each tab's native screen. */
export default function TabRoot() {
  const tab = useOwnTab();
  const { __q } = useLocalSearchParams<{ __q?: string }>();
  if (tab === "(home)") return <HomeScreen />;
  // A link's scope arrives in __q (/spending?period=…), and a new one starts the screen over on it.
  if (tab === "(accounts)") return <AccountsScreen key={__q ?? ""} query={__q} root />;
  if (tab === "(spending)") return <SpendingScreen key={__q ?? ""} query={__q} root />;
  if (tab === "(goals)") return <GoalsScreen root />;
  // Chat: a prompt arrives in __q (/chat?prompt=…&at=…). Not keyed on it: the screen starts each request once, in place.
  return <ChatScreen query={__q} root />;
}
