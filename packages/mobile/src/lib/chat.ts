import { openPath } from "./navigation";

/**
 * Asks in the chat tab: switches to it and starts a conversation with
 * `prompt` there, the way the web's /chat?prompt= does. `title` names the
 * thread after its subject (an action, a step) rather than the prompt. The
 * stamp names this one request, so the chat sends it exactly once however
 * often the screen renders, and the same question asked again is asked again.
 */
export function openChat(prompt?: string, title?: string, now: number = Date.now()) {
  if (!prompt) return openPath("/chat", "tab");
  const t = title ? `&title=${encodeURIComponent(title)}` : "";
  openPath(`/chat?prompt=${encodeURIComponent(prompt)}${t}&at=${now}`, "tab");
}

/** A chat request from a link's query (`prompt`, `title`, `at`), or null. Without a stamp the link itself names the request. */
export function chatRequest(query: string | undefined): { prompt: string; title?: string; nonce: string } | null {
  if (!query) return null;
  const p = new URLSearchParams(query);
  const prompt = p.get("prompt")?.trim();
  if (!prompt) return null;
  return { prompt, title: p.get("title") ?? undefined, nonce: p.get("at") ?? `link:${query}` };
}
