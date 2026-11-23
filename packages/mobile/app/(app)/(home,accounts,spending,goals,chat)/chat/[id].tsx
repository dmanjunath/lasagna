import { useLocalSearchParams } from "expo-router";
import ChatThreadScreen from "@/screens/ChatThreadScreen";

/** One conversation, by its server id or this device's key for it. `new` is a new conversation before its first question. */
export default function ChatThreadRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Keyed on the screen, not the id: a new conversation takes its key in place once asked.
  return <ChatThreadScreen id={id} />;
}
