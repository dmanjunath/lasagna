import type { ChatThread, Message } from "@web/lib/types";
import { API_URL } from "@/config";
import { getToken } from "@/auth/token";
import { post, request } from "./client";

// The chat area's calls, mirroring packages/web/src/lib/api.ts (threads) and
// lib/chat-store.tsx (the turn). POST /api/chat does not stream: it answers
// once with JSON when the whole agent loop is done, which can take a minute.

export type { ChatThread, Message };

/** What POST /api/chat answers. A failed generation is a 200 with `error` and nothing stored. */
export type ChatReply = {
  threadTitle: string | null;
  response: { chat: string };
  toolResults?: Array<{ toolName: string; args: unknown }>;
  model?: { level: string; slug: string };
  error?: "ai_credits" | "ai_error";
};

export const chatApi = {
  threads: () => request<{ threads: ChatThread[] }>("/threads"),
  thread: (id: string) => request<{ thread: ChatThread; messages: Message[] }>(`/threads/${id}`),
  createThread: (title?: string, tags?: string[]) => post<{ thread: ChatThread }>("/threads", { title, tags }),
  deleteThread: (id: string) => request<{ success: boolean }>(`/threads/${id}`, { method: "DELETE" }),
};

/** A turn that did not come back: the connection, a timeout, a server error. Not a stop. */
export class ChatSendError extends Error {}
/** The person stopped waiting. */
export class ChatAbortError extends Error {}

/**
 * Asks one turn. XMLHttpRequest, not fetch: fetch cannot set a timeout, and
 * iOS gives up on a request that sends nothing for 60 seconds, which a long
 * answer outlasts. `signal` stops waiting (the server still finishes the turn).
 */
export function sendChat(body: { threadId: string; message: string }, signal?: AbortSignal): Promise<ChatReply> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ChatAbortError("Stopped"));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/chat`);
    xhr.timeout = 5 * 60 * 1000;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("x-lasagna-client", "native");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      done();
      if (xhr.status < 200 || xhr.status >= 300) return reject(new ChatSendError(`Chat request failed (${xhr.status})`));
      try {
        resolve(JSON.parse(xhr.responseText) as ChatReply);
      } catch {
        reject(new ChatSendError("Unreadable reply"));
      }
    };
    xhr.onerror = () => {
      done();
      reject(new ChatSendError("Network error"));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      done();
      reject(new ChatAbortError("Stopped"));
    };
    xhr.send(JSON.stringify(body));
  });
}
