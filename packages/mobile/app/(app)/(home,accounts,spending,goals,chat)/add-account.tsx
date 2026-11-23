import { useLocalSearchParams } from "expo-router";
import AddAccountSheet from "@/screens/AddAccountSheet";

/** The Add account sheet, optionally on a form (?add=<type>[:<subtype>]&link=<counterpart id>). */
export default function AddAccountRoute() {
  const { add, link } = useLocalSearchParams<{ add?: string; link?: string }>();
  return <AddAccountSheet add={add} link={link} />;
}
