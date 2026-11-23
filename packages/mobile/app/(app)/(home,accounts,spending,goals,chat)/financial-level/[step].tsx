import { useLocalSearchParams } from "expo-router";
import JourneyStepScreen from "@/screens/JourneyStepScreen";

/** One step of the financial journey, pushed from its list. Step ids carry a colon (debt:…), so they travel encoded. */
export default function JourneyStepRoute() {
  const { step } = useLocalSearchParams<{ step: string }>();
  const id = step.includes("%") ? decodeURIComponent(step) : step;
  return <JourneyStepScreen key={id} id={id} />;
}
