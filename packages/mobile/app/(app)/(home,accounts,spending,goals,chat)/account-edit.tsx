import { useLocalSearchParams } from "expo-router";
import AccountEditSheet from "@/screens/AccountEditSheet";

/** The Edit account sheet. */
export default function AccountEditRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AccountEditSheet id={id} />;
}
