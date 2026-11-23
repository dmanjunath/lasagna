import { useLocalSearchParams } from "expo-router";
import { webStartPath } from "@/lib/routes";
import { WebScreen } from "@/web/WebScreen";

/** The web fallback for an unported path, pushed inside the current tab. */
export default function WebFallback() {
  const { path, __q, __h } = useLocalSearchParams<{ path: string[]; __q?: string; __h?: string }>();
  const startPath = webStartPath(`/${(Array.isArray(path) ? path : [path]).filter(Boolean).join("/")}`, __q, __h);
  return <WebScreen key={startPath} startPath={startPath} />;
}
