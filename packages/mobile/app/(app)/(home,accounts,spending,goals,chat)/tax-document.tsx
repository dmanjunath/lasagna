import { useLocalSearchParams } from "expo-router";
import TaxDocumentSheet from "@/screens/TaxDocumentSheet";

/** One tax document's extracted fields, as a sheet over Tax. */
export default function TaxDocumentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TaxDocumentSheet id={id} />;
}
