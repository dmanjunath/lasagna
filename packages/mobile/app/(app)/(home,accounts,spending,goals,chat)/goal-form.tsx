import { useLocalSearchParams } from "expo-router";
import GoalFormSheet from "@/screens/GoalFormSheet";

/** The New goal sheet (`kind` opens it on that kind's fields) and the Edit goal sheet (`id`, `focus`). */
export default function GoalFormRoute() {
  const { id, kind, focus } = useLocalSearchParams<{ id?: string; kind?: string; focus?: "monthly" | "accounts" | "date" }>();
  return <GoalFormSheet id={id} kind={kind} focus={focus} />;
}
