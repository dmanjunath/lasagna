import { useLocalSearchParams } from "expo-router";
import ChatScreen from "@/screens/ChatScreen";

/** The chat pushed inside another tab (a link that stays in its tab). A prompt in its query starts a conversation. */
export default function ChatRoute() {
  const params = useLocalSearchParams<{ prompt?: string; title?: string; at?: string }>();
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  return <ChatScreen query={query || undefined} />;
}
