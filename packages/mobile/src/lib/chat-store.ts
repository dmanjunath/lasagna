import { useSyncExternalStore } from "react";
import { ChatAbortError, chatApi, sendChat, type Message } from "@/api/chat";

// The conversations this device is in, outside React so a turn in flight
// survives leaving its screen (the web's lib/chat-store.tsx and
// use-global-chat.ts). A conversation started here has a local key until the
// server's thread exists, and keeps it after: `keyFor` maps the server's id
// back, so the history list opens the same conversation, answer and all.

/** A failed turn: this device did not get the reply. The server finishes and stores the turn either way. */
export const ERROR_TEXT = "This device did not get a reply. It may already be saved.";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** An assistant turn that is not an answer: `error` (it did not arrive), `stopped` (the person stopped waiting). */
  status?: "error" | "stopped";
};

export type Conversation = {
  key: string;
  serverId: string | null;
  /** The thread's title: the server's, else the question it started with. */
  title: string;
  messages: ChatTurn[];
  load: "idle" | "loading" | "ready" | "error";
  /** Waiting on an answer. */
  pending: boolean;
  /** Get the reply: looking on the server for an answer the device missed. */
  checking: boolean;
};

/** The tag the web gives a thread started on /chat (getCategoryFromRoute). */
const TAGS = ["General"];

const convos = new Map<string, Conversation>();
const aliases = new Map<string, string>();
const byNonce = new Map<string, string>();
const aborts = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let threadsVersion = 0;
let seq = 0;

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function update(key: string, f: (c: Conversation) => Conversation) {
  const c = convos.get(key);
  if (!c) return;
  convos.set(key, f(c));
  emit();
}
/** The history list has changed on the server (a turn landed, a thread went). */
function threadsChanged() {
  threadsVersion++;
  emit();
}

const turn = (role: ChatTurn["role"], content: string, status?: ChatTurn["status"]): ChatTurn => ({
  id: `${role}-${++seq}`,
  role,
  content,
  createdAt: new Date().toISOString(),
  ...(status ? { status } : {}),
});

const fromServer = (m: Message): ChatTurn => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt });

/** The conversation for a server thread (or local key). */
export function keyFor(serverId: string): string {
  return aliases.get(serverId) ?? serverId;
}

export function getConversation(key: string): Conversation | undefined {
  return convos.get(key);
}

export function useConversation(key: string | null): Conversation | undefined {
  return useSyncExternalStore(subscribe, () => (key ? convos.get(key) : undefined));
}

/** Changes whenever the history list should be fetched again. */
export function useThreadsVersion(): number {
  return useSyncExternalStore(subscribe, () => threadsVersion);
}

/** Opens a thread from the history: its messages load from the server unless this device already has them. */
export function openThread(serverId: string, title: string): string {
  const key = keyFor(serverId);
  if (!convos.has(key)) {
    // Called while a screen renders: the fetch (and what it tells listeners) waits for the next tick.
    convos.set(key, { key, serverId, title, messages: [], load: "loading", pending: false, checking: false });
    void Promise.resolve().then(() => refresh(key));
  }
  return key;
}

/**
 * Pulls the server's copy. It replaces this device's copy unless this device
 * asked more than the server holds (a question that never arrived), and never
 * while a turn is in flight. Returns whether the server answered the last question.
 */
export async function refresh(key: string): Promise<boolean> {
  const c = convos.get(key);
  if (!c?.serverId || c.pending) return false;
  if (c.messages.length === 0) update(key, (x) => ({ ...x, load: "loading" }));
  try {
    const { thread, messages } = await chatApi.thread(c.serverId);
    const now = convos.get(key);
    if (!now || now.pending) return false;
    const askedHere = now.messages.filter((m) => m.role === "user").length;
    const askedThere = messages.filter((m) => m.role === "user").length;
    const answered = messages[messages.length - 1]?.role === "assistant";
    if (askedThere < askedHere || (askedThere === askedHere && !answered && askedHere > 0)) {
      update(key, (x) => ({ ...x, load: "ready" }));
      return false;
    }
    update(key, (x) => ({ ...x, title: thread.title || x.title, messages: messages.map(fromServer), load: "ready" }));
    return answered;
  } catch {
    update(key, (x) => ({ ...x, load: x.messages.length ? "ready" : "error" }));
    return false;
  }
}

/**
 * Starts a conversation with `text`. `nonce` names the request that asked
 * (a /chat?prompt= link's stamp): the same nonce again returns the same
 * conversation and sends nothing, so a re-render or a remount never asks twice.
 */
export function startConversation(text: string, { title, nonce }: { title?: string; nonce?: string } = {}): string {
  if (nonce && byNonce.has(nonce)) return byNonce.get(nonce)!;
  const key = `new-${Date.now().toString(36)}-${++seq}`;
  if (nonce) byNonce.set(nonce, key);
  convos.set(key, { key, serverId: null, title: title || text, messages: [turn("user", text)], load: "ready", pending: true, checking: false });
  emit();
  void runTurn(key, text, title);
  return key;
}

/** Whether a conversation was already started for this nonce. */
export function startedFor(nonce: string): string | undefined {
  return byNonce.get(nonce);
}

/** Asks a follow-up. Ignored while a turn is in flight. */
export function ask(key: string, text: string) {
  const c = convos.get(key);
  if (!c || c.pending || !text.trim()) return;
  update(key, (x) => ({ ...x, pending: true, messages: [...x.messages, turn("user", text.trim())] }));
  void runTurn(key, text.trim());
}

/** Stops waiting for the answer. The server still finishes it, and a refresh later shows it. */
export function stop(key: string) {
  aborts.get(key)?.abort();
}

/**
 * Get the reply: the server finishes a turn the device lost, so look for the
 * stored answer first and ask again only if there is none (a second ask is a
 * second paid answer).
 */
export async function retry(key: string) {
  const c = convos.get(key);
  if (!c || c.pending || c.checking) return;
  const lastUser = [...c.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return;
  update(key, (x) => ({ ...x, checking: true }));
  const found = await refresh(key);
  update(key, (x) => ({ ...x, checking: false }));
  if (found) return;
  update(key, (x) => {
    const last = x.messages[x.messages.length - 1];
    return { ...x, pending: true, messages: last?.status ? x.messages.slice(0, -1) : x.messages };
  });
  void runTurn(key, lastUser.content);
}

/** Deletes a thread on the server and forgets it here. */
export async function deleteThread(serverId: string) {
  await chatApi.deleteThread(serverId);
  const key = keyFor(serverId);
  convos.delete(key);
  aliases.delete(serverId);
  threadsChanged();
}

async function runTurn(key: string, text: string, title?: string) {
  const controller = new AbortController();
  aborts.set(key, controller);
  try {
    let serverId = convos.get(key)?.serverId ?? null;
    if (!serverId) {
      const { thread } = await chatApi.createThread(title, TAGS);
      serverId = thread.id;
      aliases.set(serverId, key);
      update(key, (x) => ({ ...x, serverId }));
    }
    if (controller.signal.aborted) throw new ChatAbortError("Stopped");
    const reply = await sendChat({ threadId: serverId, message: text }, controller.signal);
    // A failed generation stores nothing and says why. It reads as a failed turn, with Get the reply.
    const answer = reply.error
      ? turn("assistant", reply.response?.chat || ERROR_TEXT, "error")
      : turn("assistant", reply.response?.chat?.trim() || "I apologize, but I could not process your request.");
    update(key, (x) => ({ ...x, pending: false, title: reply.threadTitle || x.title, messages: [...x.messages, answer] }));
  } catch (e) {
    const stopped = e instanceof ChatAbortError;
    update(key, (x) => ({ ...x, pending: false, messages: [...x.messages, turn("assistant", stopped ? "" : ERROR_TEXT, stopped ? "stopped" : "error")] }));
  } finally {
    aborts.delete(key);
    threadsChanged();
  }
}

/** For tests. */
export function resetChatStore() {
  convos.clear();
  aliases.clear();
  byNonce.clear();
  aborts.clear();
  threadsVersion = 0;
}
