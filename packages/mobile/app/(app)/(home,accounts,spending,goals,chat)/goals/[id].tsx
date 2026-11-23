import { useLocalSearchParams } from "expo-router";
import GoalDetailScreen from "@/screens/GoalDetailScreen";

/** One goal (/goals/:id, and the older /plans/savings/:id). `edit=1` opens the Edit goal sheet on its monthly plan. */
export default function GoalDetailRoute() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  return <GoalDetailScreen key={id} id={id} edit={edit === "1"} />;
}
