import { MenuView, type NativeActionEvent } from "@react-native-menu/menu";
import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { chatApi, type ChatThread } from "@/api/chat";
import { STARTER_PROMPTS } from "@/components/chat/ChatIntro";
import { useTheme as useDesign } from "@/design";
import { chatRequest } from "@/lib/chat";
import { deleteThread, openThread, startConversation, startedFor, useThreadsVersion } from "@/lib/chat-store";
import { stripMarkdown, threadDate } from "@/lib/chat-text";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { useOwnTab } from "@/shell/tab-context";
import { icon, space, themedStyles, type, useTheme, weight } from "@/theme";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { committed, failed } from "@/ui/feedback";
import { Divider, SectionHeader } from "@/ui/Form";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { ErrorState } from "@/ui/State";
import ChatThreadScreen from "./ChatThreadScreen";
import { pressFeedback } from "@/ui/press";

type RowItem = { thread: ChatThread; first: boolean };

/**
 * The chat (/chat, the web's chat-full-page.tsx on a phone): past
 * conversations, newest first, then questions to start one. New chat is the
 * bar's verb. With no history yet it opens straight on a new conversation.
 * `query`: a link's query (/chat?prompt=…&title=…&at=…) starts a
 * conversation with that prompt and opens it, exactly once per request.
 */
export default function ChatScreen({ query, root = false }: { query?: string; root?: boolean }) {
  const d = useDesign();
  const tab = useOwnTab();
  const threads = useQuery({ queryKey: ["chat-threads"], queryFn: chatApi.threads });
  const version = useThreadsVersion();
  const { refetch } = threads;
  useEffect(() => {
    if (version > 0) void refetch();
  }, [version, refetch]);

  const open = useCallback((key: string) => router.push(`/${tab}/chat/${key}` as never), [tab]);
  const start = useCallback((prompt: string, opts?: { title?: string; nonce?: string }) => open(startConversation(prompt, opts)), [open]);

  // A prompt handed over by a link (Home's Ask card, an action's Ask). The request's stamp makes it send once.
  const request = useMemo(() => chatRequest(query), [query]);
  useEffect(() => {
    if (!request) return;
    // The link is spent once read (as the web strips ?prompt=), so a reload or remount cannot ask again.
    router.setParams(root ? { __q: undefined } : { prompt: undefined, title: undefined, at: undefined });
    if (startedFor(request.nonce)) return;
    start(request.prompt, { title: request.title, nonce: request.nonce });
  }, [request, start, root]);

  const list = threads.data?.threads;
  if (list && list.length === 0) return <ChatThreadScreen id="new" title={d.chatTitle} root={root} />;
  return <ThreadList threads={threads} onOpen={open} onAsk={(p) => start(p)} root={root} />;
}

function ThreadList({
  threads,
  onOpen,
  onAsk,
  root,
}: {
  threads: ReturnType<typeof useQuery<{ threads: ChatThread[] }>>;
  onOpen: (key: string) => void;
  onAsk: (prompt: string) => void;
  root: boolean;
}) {
  const d = useDesign();
  const tab = useOwnTab();
  const hidden = useAmountsHidden();
  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await threads.refetch();
    } finally {
      setPulling(false);
    }
  };
  const list = threads.data?.threads;

  const remove = useCallback((th: ChatThread) => {
    Alert.alert("Delete this conversation?", "Its messages are removed for good.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteThread(th.id);
          } catch {
            failed("Couldn't delete the conversation. Try again.");
            return;
          }
          committed("Conversation deleted");
        },
      },
    ]);
  }, []);
  const openRow = useCallback((th: ChatThread) => onOpen(openThread(th.id, th.title || th.firstMessage || "")), [onOpen]);

  return (
    <>
      {/* The page chrome contract: Chat's verb is New chat. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New chat" onPress={() => router.push(`/${tab}/chat/new` as never)} />
      </Stack.Toolbar>
      {/* A conversation list stays short (dozens), so one card of rows in a scroll view, as every other list in the app. */}
      <ScreenScroll title={d.chatTitle} root={root} refreshing={pulling} onRefresh={() => void onPull()}>
        {list ? (
          <View style={styles.section}>
            <SectionHeader>Conversations</SectionHeader>
            <Card style={styles.listCard}>
              {list.map((thread, i) => (
                <ThreadRow key={thread.id} item={{ thread, first: i === 0 }} hidden={hidden} onOpen={openRow} onDelete={remove} />
              ))}
            </Card>
          </View>
        ) : threads.isError ? (
          <ErrorState title="Couldn't load your conversations" body="Check your connection and try again." onRetry={() => void threads.refetch()} />
        ) : (
          <RowSkeletons />
        )}
        {list ? (
          <View style={styles.prompts}>
            <SectionHeader>Try asking</SectionHeader>
            <View style={styles.chips}>
              {STARTER_PROMPTS.map((p) => (
                <Chip key={p} label={p} icon="arrow.up.right" wrap onPress={() => onAsk(p)} accessibilityLabel={`Ask: ${p}`} />
              ))}
            </View>
          </View>
        ) : null}
      </ScreenScroll>
    </>
  );
}

/** One past conversation: its title, the start of its answer, its day. Long press deletes it. */
function ThreadRow({ item, hidden, onOpen, onDelete }: { item: RowItem; hidden: boolean; onOpen: (t: ChatThread) => void; onDelete: (t: ChatThread) => void }) {
  const t = useTheme();
  void hidden;
  const th = item.thread;
  const title = maskCurrencyInText(th.title || th.firstMessage || "Conversation");
  const preview = th.firstAssistantSnippet ? maskCurrencyInText(stripMarkdown(th.firstAssistantSnippet).slice(0, 200)) : "";
  const date = threadDate(th.updatedAt || th.createdAt);
  return (
    // Rows in the list card, a hairline between them.
    <View>
      {item.first ? null : <Divider />}
      <MenuView
        shouldOpenOnLongPress
        title={title}
        actions={[{ id: "delete", title: "Delete", image: "trash", imageColor: t.negative, attributes: { destructive: true } }]}
        onPressAction={({ nativeEvent }: NativeActionEvent) => nativeEvent.event === "delete" && onDelete(th)}
      >
        <Pressable
          onPress={() => onOpen(th)}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${date}`}
          accessibilityHint="Opens the conversation. Long press to delete."
          accessibilityActions={[{ name: "delete", label: "Delete" }]}
          onAccessibilityAction={(e) => e.nativeEvent.actionName === "delete" && onDelete(th)}
          style={({ pressed }) => [styles.row, pressFeedback(t, pressed)]}
        >
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: t.content }]} numberOfLines={2}>
              {title}
            </Text>
            {preview ? (
              <Text style={[styles.rowPreview, { color: t.contentMuted }]} numberOfLines={1}>
                {preview}
              </Text>
            ) : null}
            <Text style={[styles.rowDate, { color: t.contentMuted }]}>{date}</Text>
          </View>
          <SymbolView name="chevron.right" size={icon.sm} weight="semibold" tintColor={t.contentFaint} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      </MenuView>
    </View>
  );
}

/** The list's outline while it loads. */
function RowSkeletons() {
  return (
    <Card style={styles.skelCard}>
      {Array.from({ length: 4 }, (_, i) => (
        <View key={i} style={styles.skelRow} accessible={i === 0} accessibilityLabel={i === 0 ? "Loading" : undefined}>
          <Skeleton width="70%" height={14} />
          <Skeleton width="90%" height={12} />
          <Skeleton width="20%" height={10} />
        </View>
      ))}
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    section: { gap: 6 },
    listCard: { padding: 0 },
    row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.rowInset, paddingVertical: space.md, minHeight: 64 },
    rowText: { flex: 1, gap: 3 },
    rowTitle: { ...type.callout, ...weight.semibold },
    rowPreview: { ...type.footnote },
    rowDate: { ...type.caption, ...weight.medium },
    prompts: { gap: space.md, paddingTop: space.md },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.card },
    skelCard: { padding: 0 },
    skelRow: { gap: 8, paddingHorizontal: space.rowInset, paddingVertical: space.md },
  }),
);
