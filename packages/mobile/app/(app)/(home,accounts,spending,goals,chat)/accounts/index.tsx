import { useLocalSearchParams } from "expo-router";
import AccountsScreen from "@/screens/AccountsScreen";

/** Accounts pushed inside another tab (Home's net worth "See all", an empty state's Connect a bank), its links in the route's own params. */
export default function AccountsPushed() {
  const { autoLink, reconnect, add, link } = useLocalSearchParams<{ autoLink?: string; reconnect?: string; add?: string; link?: string }>();
  const query = [autoLink && `autoLink=${autoLink}`, reconnect && `reconnect=${reconnect}`, add && `add=${add}`, link && `link=${link}`].filter(Boolean).join("&");
  return <AccountsScreen key={query} query={query} root={false} />;
}
