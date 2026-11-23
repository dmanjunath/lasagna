import * as WebBrowser from "expo-web-browser";
import { Fragment, memo, useMemo } from "react";
import { Linking, ScrollView, StyleSheet, Text, useWindowDimensions, View, type TextStyle } from "react-native";
import { WEB_URL } from "@/config";
import { useTheme as useDesign } from "@/design";
import { linkTarget } from "@/lib/chat-text";
import { inlineText, parseMarkdown, type Align, type Block, type Inline } from "@/lib/markdown";
import { openPath } from "@/lib/navigation";
import { space, themedStyles, type, useTheme, weight } from "@/theme";

/**
 * An answer's Markdown drawn natively, styled as the web's message-bubble.tsx
 * styles react-markdown: prose in the secondary ink, bold in the main ink,
 * list markers in the accent, tables on a sunken header. A link to an app
 * page opens it in this tab (pushed over the chat, which never changes), a
 * web page opens in the in-app browser.
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <Blocks blocks={blocks} />;
});

function openLink(href: string, tint: string) {
  const target = linkTarget(href, WEB_URL);
  if (!target) return;
  if (target.kind === "app") openPath(target.path);
  else if (target.kind === "web") void WebBrowser.openBrowserAsync(target.url, { controlsColor: tint, presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  else void Linking.openURL(target.url);
}

function Blocks({ blocks, tight }: { blocks: Block[]; tight?: boolean }) {
  return (
    <View style={tight ? styles.tight : styles.blocks}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} first={i === 0} />
      ))}
    </View>
  );
}

function BlockView({ block: b, first }: { block: Block; first: boolean }) {
  const t = useTheme();
  const d = useDesign();
  switch (b.type) {
    case "heading": {
      const style = b.level === 1 ? styles.h1 : b.level === 2 ? styles.h2 : styles.h3;
      return (
        <Text style={[style, !first && b.level <= 2 && styles.headingGap, { color: t.content }]} accessibilityRole="header">
          <Inlines nodes={b.children} />
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text style={[styles.p, { color: t.contentSecondary }]}>
          <Inlines nodes={b.children} />
        </Text>
      );
    case "list":
      return (
        <View style={styles.list}>
          {b.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={[styles.p, styles.marker, b.ordered ? { color: t.contentSecondary } : { color: t.accentInk }]} accessibilityElementsHidden importantForAccessibility="no">
                {b.ordered ? `${b.start + i}.` : "•"}
              </Text>
              <View style={styles.itemBody}>
                <Blocks blocks={item} tight />
              </View>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderLeftColor: t.accent }]}>
          <Blocks blocks={b.children} tight />
        </View>
      );
    case "code":
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.codeBlock, { backgroundColor: t.canvasSunken, borderColor: t.line, borderRadius: d.radius.sm }]}>
          <Text style={[styles.code, { color: t.content }]}>{b.text}</Text>
        </ScrollView>
      );
    case "rule":
      return <View style={[styles.rule, { backgroundColor: t.line }]} />;
    case "table":
      return <Table align={b.align} head={b.head} rows={b.rows} />;
  }
}

/** A table scrolls sideways when it is wider than the bubble. Each column is as wide as its longest cell, within limits. */
function Table({ align, head, rows }: { align: Align[]; head: Inline[][]; rows: Inline[][][] }) {
  const t = useTheme();
  const d = useDesign();
  const { fontScale } = useWindowDimensions();
  const widths = head.map((h, c) => {
    const longest = Math.max(inlineText(h).length, ...rows.map((r) => inlineText(r[c] ?? []).length));
    return Math.round(Math.min(220, Math.max(72, longest * 7.4 + 26)) * Math.min(fontScale, 2));
  });
  const cell = (nodes: Inline[], c: number, header: boolean) => (
    <View key={c} style={[styles.cell, { width: widths[c] }]}>
      <Text style={[header ? styles.th : styles.td, { color: header ? t.content : t.contentSecondary, textAlign: align[c] ?? "left" }]}>
        <Inlines nodes={nodes} />
      </Text>
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.table, { borderColor: t.line, borderRadius: d.radius.sm }]}>
      <View>
        <View style={[styles.tr, { backgroundColor: t.canvasSunken, borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>{head.map((h, c) => cell(h, c, true))}</View>
        {rows.map((r, i) => (
          <View key={i} style={[styles.tr, i < rows.length - 1 && { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            {r.map((x, c) => cell(x, c, false))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Inlines({ nodes, style }: { nodes: Inline[]; style?: TextStyle }) {
  const t = useTheme();
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>;
          case "break":
            return <Fragment key={i}>{"\n"}</Fragment>;
          case "strong":
            return (
              <Text key={i} style={[style, styles.strong, { color: t.content }]}>
                <Inlines nodes={n.children} style={style} />
              </Text>
            );
          case "em":
            return (
              <Text key={i} style={[style, styles.em]}>
                <Inlines nodes={n.children} style={style} />
              </Text>
            );
          case "code":
            return (
              <Text key={i} style={[styles.inlineCode, { color: t.content, backgroundColor: t.canvasSunken }]}>
                {n.text}
              </Text>
            );
          case "link":
            return (
              <Text
                key={i}
                onPress={() => openLink(n.href, t.brandInk)}
                accessibilityRole="link"
                accessibilityLabel={inlineText(n.children)}
                suppressHighlighting={false}
                style={[style, styles.link, { color: t.brandInk, textDecorationColor: t.brandInk }]}
              >
                <Inlines nodes={n.children} style={style} />
              </Text>
            );
        }
      })}
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    blocks: { gap: space.md },
    tight: { gap: space.xs },
    h1: { ...type.title },
    h2: { ...type.headline },
    h3: { ...type.callout, ...weight.semibold },
    headingGap: { marginTop: space.xs },
    p: { ...type.callout },
    strong: { ...weight.semibold },
    em: { fontStyle: "italic" },
    link: { ...weight.semibold, textDecorationLine: "underline" },
    list: { gap: space.xs },
    item: { flexDirection: "row", gap: space.sm },
    marker: { minWidth: 14, textAlign: "right" },
    itemBody: { flex: 1, minWidth: 0 },
    quote: { borderLeftWidth: 2, paddingLeft: space.md, paddingVertical: space.xxs },
    codeBlock: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: space.sm },
    code: { ...type.footnote, fontFamily: "Menlo" },
    inlineCode: { ...type.footnote, fontFamily: "Menlo" },
    rule: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
    table: { borderWidth: StyleSheet.hairlineWidth, flexGrow: 0 },
    tr: { flexDirection: "row" },
    cell: { paddingHorizontal: space.md, paddingVertical: space.sm, justifyContent: "center" },
    th: { ...type.footnote, ...weight.semibold },
    td: { ...type.footnote, fontVariant: ["tabular-nums"] },
  }),
);
