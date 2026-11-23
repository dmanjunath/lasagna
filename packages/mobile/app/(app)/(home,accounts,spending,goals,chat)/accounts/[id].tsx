import { useLocalSearchParams } from "expo-router";
import AccountDetailScreen from "@/screens/AccountDetailScreen";

/** One account (/accounts/:id). `edit=1` is the /accounts/:id/edit link: the settings sheet opens over it. */
export default function AccountDetailRoute() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  return <AccountDetailScreen key={id} id={id} edit={edit === "1"} />;
}
