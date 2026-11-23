import { useLocalSearchParams } from "expo-router";
import JourneyScreen from "@/screens/JourneyScreen";

/** The financial journey (/financial-level). `step` is the web's ?step= link to one step. */
export default function JourneyRoute() {
  const { step } = useLocalSearchParams<{ step?: string }>();
  return <JourneyScreen step={step} />;
}
