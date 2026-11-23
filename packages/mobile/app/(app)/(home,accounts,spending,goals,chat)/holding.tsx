import { useLocalSearchParams } from "expo-router";
import HoldingSheet from "@/screens/HoldingSheet";

/** One holding's accounts, as a sheet over Portfolio. */
export default function HoldingRoute() {
  const { symbol, label, name } = useLocalSearchParams<{ symbol: string; label?: string; name?: string }>();
  return <HoldingSheet symbol={symbol} label={label || symbol} name={name ?? null} />;
}
