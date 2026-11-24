import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { ChatIntro } from "@/components/chat/ChatIntro";
import { Composer } from "@/components/chat/Composer";
import { MessageBubble, Thinking } from "@/components/chat/MessageBubble";
import { useComposerInset } from "@/components/chat/useComposerInset";
import { ask, getConversation, openThread, refresh, retry, startConversation, stop, useConversation, type ChatTurn } from "@/lib/chat-store";
import { maskCurrencyInText, useAmountsHidden } from "@/lib/hide-amounts";
import { pushInTab } from "@/lib/navigation";
import { radius, space, themedStyles } from "@/theme";
import { ScreenTitle, useCollapsingHeader } from "@/ui/ScreenScroll";
import { Skeleton } from "@/ui/Skeleton";
import { ErrorState } from "@/ui/State";
import { useTextScaleKey } from "@/ui/text-scale";

type Item = { type: "turn"; turn: ChatTurn; last: boolean } | { type: "thinking" };

/**
 * One conversation (the web's chat-thread-view.tsx on a phone), or a new one
 * before its first question (`id` "new", the web's NewChatHero). The title
 * scrolls with the messages, the composer stays above the tab bar and the
 * keyboard, and a turn in flight keeps going if the screen goes away.
 * `root`: the chat tab's own root with no history yet, which opens on this
 * new conversation, and pushes the conversation once the first question is asked.
 */
export default function ChatThreadScreen({ id, title: rootTitle, root = false }: { id: string; title?: string; root?: boolean }) {
  const hidden = useAmountsHidden();
  const [key, setKey] = useState<string | null>(() => (id === "new" ? null : getConversation(id) ? id : id.startsWith("new-") ? id : openThread(id, "")));
  const convo = useConversation(key);
  // Once the server has the thread, the route names it by its id, so the screen can always find it again.
  const serverId = convo?.serverId;
  useEffect(() => {
    if (serverId && id !== serverId && !root) router.setParams({ id: serverId });
  }, [serverId, id, root]);
  const draft = key === null;
  const title = rootTitle ?? (draft ? "New chat" : maskCurrencyInText(convo?.title ?? ""));
  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    if (!key) return;
    setPulling(true);
    try {
      await refresh(key);
    } finally {
      setPulling(false);
    }
  };
  const chrome = useCollapsingHeader({ title, root, refreshing: pulling, onRefresh: draft || convo?.pending ? undefined : () => void onPull() });
  const inset = useComposerInset();
  const listRef = useRef<FlashListRef<Item>>(null);
  const scaleKey = useTextScaleKey();

  const send = useCallback(
    (text: string) => {
      if (key) {
        ask(key, text);
        return;
      }
      const next = startConversation(text);
      if (root) {
        // The tab's root stays the list. The conversation opens over it.
        pushInTab(`/chat/${next}`);
        return;
      }
      setKey(next);
      router.setParams({ id: next });
    },
    [key, root],
  );

  const items = useMemo<Item[]>(() => {
    const msgs = convo?.messages ?? [];
    const out: Item[] = msgs.map((turn, i) => ({ type: "turn", turn, last: i === msgs.length - 1 }));
    if (convo?.pending) out.push({ type: "thinking" });
    return out;
  }, [convo?.messages, convo?.pending]);

  const size = useRef({ content: 0, view: 0 });
  // To the newest message, when the thread is taller than the screen (one that fits stays at rest, its title in view).
  const toEnd = useCallback(() => {
    if (size.current.content > size.current.view) void listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // A question just asked: it and the thinking row come into view at the foot. The answer then arrives
  // where the thinking row was, so it reads from its start. A thread opens at its top.
  const pending = !!convo?.pending;
  const count = items.length;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(toEnd, 120);
    return () => clearTimeout(t);
  }, [pending, count, toEnd]);

  // The keyboard coming up keeps the newest message in view.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", toEnd);
    return () => sub.remove();
  }, [toEnd]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Item>) => (
      <View style={styles.row}>
        {item.type === "thinking" ? (
          <Thinking />
        ) : (
          <MessageBubble message={item.turn} hidden={hidden} onRetry={item.last && key ? () => void retry(key) : undefined} checking={item.last && convo?.checking} />
        )}
      </View>
    ),
    [hidden, key, convo?.checking],
  );

  const loading = !!convo && convo.load === "loading" && convo.messages.length === 0;
  const failed = !!convo && convo.load === "error" && convo.messages.length === 0;
  const lost = !draft && !convo;

  const header = (
    <View style={styles.header}>
      {title ? <ScreenTitle title={title} root={root} onLayout={chrome.onTitleLayout} /> : null}
      {draft ? <ChatIntro onAsk={send} /> : null}
      {loading ? <Skeletons /> : null}
      {failed && key ? <ErrorState title="Couldn't load this conversation" body="Check your connection and try again." onRetry={() => void refresh(key)} /> : null}
      {lost ? <ErrorState title="This conversation isn't available" retryLabel="Back to chat" onRetry={() => router.back()} /> : null}
    </View>
  );

  return (
    <>
      {chrome.bar}
      <View ref={inset.boxRef} onLayout={inset.onLayout} style={styles.screen}>
        <FlashList<Item>
          // Rows are measured again when the text size changes (see text-scale.ts).
          key={scaleKey}
          ref={(r) => {
            listRef.current = r;
            chrome.scrollRef(r);
          }}
          data={items}
          renderItem={renderItem}
          extraData={renderItem}
          keyExtractor={(it) => (it.type === "thinking" ? "thinking" : it.turn.id)}
          getItemType={(it) => (it.type === "thinking" ? "thinking" : it.turn.role)}
          ListHeaderComponent={header}
          contentInsetAdjustmentBehavior="automatic"
          // Rows only append, and the newest is shown on purpose (above).
          maintainVisibleContentPosition={{ disabled: true }}
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onContentSizeChange={(_w, h) => (size.current.content = h)}
          onLayout={(e) => (size.current.view = e.nativeEvent.layout.height)}
          refreshControl={chrome.refreshControl}
          {...chrome.dragHandlers}
        />
        {chrome.refreshOverlay}
        {lost || failed ? null : (
          <Composer
            placeholder={draft ? "Ask anything" : "Follow up"}
            pending={!!convo?.pending}
            onSend={send}
            onStop={
              key
                ? () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    stop(key);
                  }
                : undefined
            }
          />
        )}
        <Animated.View style={inset.spacer} />
      </View>
    </>
  );
}

/** A conversation's outline while it loads: a question and an answer. */
function Skeletons() {
  return (
    <View style={styles.skeletons} accessible accessibilityLabel="Loading">
      <Skeleton width="55%" height={40} style={styles.skelUser} />
      <View style={styles.skelAnswer}>
        <Skeleton width={28} height={28} style={styles.skelAvatar} />
        <View style={styles.skelLines}>
          <Skeleton width="90%" height={12} />
          <Skeleton width="100%" height={12} />
          <Skeleton width="70%" height={12} />
        </View>
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    screen: { flex: 1 },
    content: { paddingHorizontal: space.screen, paddingBottom: space.lg },
    header: { paddingBottom: space.sm },
    row: { paddingHorizontal: space.sm, paddingVertical: space.sm },
    skeletons: { gap: space.lg, paddingHorizontal: space.sm, paddingTop: space.lg },
    skelUser: { alignSelf: "flex-end", borderRadius: radius.lg },
    skelAnswer: { flexDirection: "row", gap: space.md },
    skelAvatar: { borderRadius: radius.pill },
    skelLines: { flex: 1, gap: 8 },
  }),
);
