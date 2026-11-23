import { useLocalSearchParams } from "expo-router";
import SpendingScreen from "@/screens/SpendingScreen";

/** Spending pushed inside another tab (Home's "See all"), its scope in the route's own params. */
export default function SpendingPushed() {
  const { period, categories, excludeCategories } = useLocalSearchParams<{ period?: string; categories?: string; excludeCategories?: string }>();
  const query = [period && `period=${period}`, categories && `categories=${categories}`, excludeCategories && `excludeCategories=${excludeCategories}`]
    .filter(Boolean)
    .join("&");
  return <SpendingScreen key={query} query={query} root={false} />;
}
