import GoalsScreen from "@/screens/GoalsScreen";

/** Goals pushed inside another tab (Home's goals card "See all"). */
export default function GoalsPushed() {
  return <GoalsScreen root={false} />;
}
