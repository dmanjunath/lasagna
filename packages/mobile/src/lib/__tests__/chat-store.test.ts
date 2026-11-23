import reply from "./fixtures/chat-reply.json";
import { parseMarkdown, type Block } from "../markdown";
import { hideIdCitations } from "../chat-text";

// The chat API, with the turn answered from a recorded reply (synthetic content).
jest.mock("@/api/chat", () => {
  class ChatAbortError extends Error {}
  class ChatSendError extends Error {}
  return {
    ChatAbortError,
    ChatSendError,
    chatApi: { threads: jest.fn(), thread: jest.fn(), createThread: jest.fn(), deleteThread: jest.fn() },
    sendChat: jest.fn(),
  };
});

import { ChatAbortError, chatApi, sendChat } from "@/api/chat";
const mockApi = chatApi as unknown as Record<keyof typeof chatApi, jest.Mock>;
const mockSend = sendChat as unknown as jest.Mock;
import { ask, ERROR_TEXT, getConversation, keyFor, openThread, resetChatStore, retry, startConversation, stop } from "../chat-store";

const THREAD = "00000000-0000-4000-8000-0000000000aa";
const flush = () => new Promise((r) => setTimeout(r, 0));
const serverMsg = (role: "user" | "assistant", content: string, i: number) => ({ id: `m${i}`, threadId: THREAD, role, content, toolCalls: null, uiPayload: null, createdAt: new Date(2026, 10, 22, 9, i).toISOString() });

beforeEach(() => {
  resetChatStore();
  jest.resetAllMocks();
  mockApi.createThread.mockResolvedValue({ thread: { id: THREAD } });
});

test("a new conversation creates the thread, asks once, and shows the answer and title", async () => {
  mockSend.mockResolvedValue(reply);
  const key = startConversation("How did I do in October?", { nonce: "n1" });
  expect(getConversation(key)).toMatchObject({ pending: true, title: "How did I do in October?" });
  await flush();
  expect(mockApi.createThread).toHaveBeenCalledWith(undefined, ["General"]);
  expect(mockSend).toHaveBeenCalledWith({ threadId: THREAD, message: "How did I do in October?" }, expect.any(Object));
  const c = getConversation(key)!;
  expect(c.pending).toBe(false);
  expect(c.title).toBe("Monthly Spending Check");
  expect(c.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(c.messages[1].content).toBe(reply.response.chat);
  // The history list's row opens this same conversation.
  expect(keyFor(THREAD)).toBe(key);
});

test("the same request asks only once, however often it arrives", async () => {
  mockSend.mockResolvedValue(reply);
  const a = startConversation("Hi", { nonce: "n2" });
  const b = startConversation("Hi", { nonce: "n2" });
  await flush();
  expect(b).toBe(a);
  expect(mockSend).toHaveBeenCalledTimes(1);
});

test("a launch title names the thread", async () => {
  mockSend.mockResolvedValue({ ...reply, threadTitle: null });
  const key = startConversation("Walk me through this insight: ...", { title: "Cut dining" });
  await flush();
  expect(mockApi.createThread).toHaveBeenCalledWith("Cut dining", ["General"]);
  expect(getConversation(key)!.title).toBe("Cut dining");
});

test("a failed generation is a failed turn with the server's words", async () => {
  mockSend.mockResolvedValue({ threadTitle: null, response: { chat: "I ran into an error generating a response. Please try again in a moment." }, error: "ai_error" });
  const key = startConversation("Hi");
  await flush();
  expect(getConversation(key)!.messages[1]).toMatchObject({ status: "error", content: "I ran into an error generating a response. Please try again in a moment." });
});

test("a lost reply is recovered from the server before asking again", async () => {
  mockSend.mockRejectedValueOnce(new Error("Network error"));
  const key = startConversation("Hi");
  await flush();
  expect(getConversation(key)!.messages[1]).toMatchObject({ status: "error", content: ERROR_TEXT });

  // The server finished the turn anyway.
  mockApi.thread.mockResolvedValue({ thread: { id: THREAD, title: "Saying hi" }, messages: [serverMsg("user", "Hi", 1), serverMsg("assistant", "Hello.", 2)] });
  await retry(key);
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(getConversation(key)!.messages.map((m) => m.content)).toEqual(["Hi", "Hello."]);
});

test("with nothing stored, Get the reply asks again", async () => {
  mockSend.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce(reply);
  const key = startConversation("Hi");
  await flush();
  mockApi.thread.mockResolvedValue({ thread: { id: THREAD, title: null }, messages: [] });
  await retry(key);
  await flush();
  expect(mockSend).toHaveBeenCalledTimes(2);
  expect(getConversation(key)!.messages.map((m) => m.status ?? m.role)).toEqual(["user", "assistant"]);
});

test("stop ends the wait and marks the turn stopped", async () => {
  mockSend.mockImplementation((_b: unknown, signal: AbortSignal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new ChatAbortError("Stopped")))));
  const key = startConversation("Long question");
  await flush();
  stop(key);
  await flush();
  const c = getConversation(key)!;
  expect(c.pending).toBe(false);
  expect(c.messages[1]).toMatchObject({ status: "stopped" });
});

test("a follow-up waits for the turn in flight", async () => {
  let resolve: (v: unknown) => void = () => {};
  mockSend.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  const key = startConversation("First");
  await flush();
  ask(key, "Second");
  expect(getConversation(key)!.messages).toHaveLength(1);
  resolve(reply);
  await flush();
  mockSend.mockResolvedValueOnce({ ...reply, response: { chat: "Second answer" } });
  ask(key, "Second");
  await flush();
  expect(getConversation(key)!.messages.map((m) => m.content)).toEqual(["First", reply.response.chat, "Second", "Second answer"]);
  expect(mockApi.createThread).toHaveBeenCalledTimes(1);
});

test("a thread from the history loads its messages", async () => {
  mockApi.thread.mockResolvedValue({ thread: { id: THREAD, title: "Old one" }, messages: [serverMsg("user", "Q", 1), serverMsg("assistant", "A", 2)] });
  const key = openThread(THREAD, "Old one");
  expect(getConversation(key)!.load).toBe("loading");
  await flush();
  expect(getConversation(key)).toMatchObject({ load: "ready", title: "Old one" });
  expect(getConversation(key)!.messages).toHaveLength(2);
});

test("the recorded answer renders as headings, a table, lists and app links, with the id citation gone", () => {
  const blocks = parseMarkdown(hideIdCitations(reply.response.chat));
  expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "heading", "table", "list", "heading", "list"]);
  expect(JSON.stringify(blocks)).not.toMatch(/0000-4000|get_debts|get_financial_path|\[profile/);
  const steps = blocks[6] as Extract<Block, { type: "list" }>;
  const links = JSON.stringify(steps).match(/"href":"[^"]+"/g);
  expect(links).toEqual(['"href":"/spending?period=2026-10"', '"href":"/transactions?categories=dining&period=2026-10"', '"href":"https://example.test/savings-rate"']);
});
