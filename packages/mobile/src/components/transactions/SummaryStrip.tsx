import type { TxnQueryRow, TxnQuerySummary } from "@web/lib/api";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { formatCurrencyExact } from "@/lib/format";
import { HIDDEN_AMOUNT } from "@/lib/hide-amounts";
import type { TxnFilters } from "@/lib/txn-filters";
import { kpiFigures, summaryRangeLabel } from "@/lib/txn-list";
import { useTheme as useDesign } from "@/design";
import { figures, icon, space, themedStyles, type, type Palette, useTheme, weight } from "@/theme";
import { Card } from "@/ui/Card";

type Tone = "pos" | "neg" | undefined;

// A masked figure sheds its tone too: the color would still say which way it went.
const toneColor = (t: Palette, value: string, tone: Tone) =>
  value === HIDDEN_AMOUNT ? t.content : tone === "pos" ? t.brandInk : tone === "neg" ? t.negative : t.content;

/**
 * The sides worth showing. A side that sums to zero over the match says
 * nothing, and Net would only restate the other one, so both drop out, just
 * as under a Credit or Debit filter.
 */
function shownSides(summary: TxnQuerySummary, kind: TxnFilters["kind"]) {
  const moneyIn = kind !== "out" && summary.totalCredits !== 0;
  const moneyOut = kind !== "in" && summary.totalDebits !== 0;
  return { moneyIn, moneyOut, net: moneyIn && moneyOut };
}

// Past this text size two figures side by side break mid-word, so the tiles stack.
const STACK_FONT_SCALE = 1.3;
// A tile's inner inset. The count line under the tiles shares it, so its text starts where theirs does.
const TILE_INSET = 14;

/**
 * One side of the money: its own tile in its direction's tint (money in on
 * the income tint, out on the spend tint), with its total and its largest
 * transaction. Here the color carries meaning, which way the money went, so
 * this screen keeps two tints (owner, 2026-11-23: color used thoughtfully).
 */
function Tile({ label, value, tone, largest, onOpen, wide }: { label: string; value: string; tone: "pos" | "neg"; largest: TxnQueryRow | null; onOpen: (tx: TxnQueryRow) => void; wide: boolean }) {
  const t = useTheme();
  const ink = useDesign().color.tint[tone === "pos" ? "income" : "spend"].ink;
  return (
    <Card hero={tone === "pos" ? "income" : "spend"} style={[styles.tile, wide ? { width: "100%" } : { flex: 1 }]}>
      <View accessible accessibilityLabel={`${label}, ${value}`}>
        <Text style={[styles.label, { color: ink }]}>{label}</Text>
        <Text style={[styles.value, { color: tone === "pos" ? t.positive : t.content }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
      {largest ? <Largest tx={largest} onOpen={onOpen} /> : null}
    </Card>
  );
}

/** One figure of the `card` summary skin: a label, the figure, and what sits under it. */
function Cell({ label, value, tone, sub, wide }: { label: string; value: string; tone?: Tone; sub?: React.ReactNode; wide: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.cell, { width: wide ? "100%" : "50%" }]}>
      <View accessible accessibilityLabel={`${label}, ${value}`} style={{ gap: 4 }}>
        <Text style={[styles.cellLabel, { color: t.contentMuted }]}>{label}</Text>
        <Text style={[styles.value, { color: toneColor(t, value, tone) }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      </View>
      {sub}
    </View>
  );
}

function Largest({ tx, onOpen, link }: { tx: TxnQueryRow; onOpen: (tx: TxnQueryRow) => void; link?: boolean }) {
  const t = useTheme();
  const ink = link ? t.brandInk : t.contentSecondary;
  const amount = formatCurrencyExact(Math.abs(parseFloat(tx.amount)));
  return (
    <Pressable
      onPress={() => onOpen(tx)}
      accessibilityRole="link"
      accessibilityLabel={`Largest ${amount}, ${tx.merchantName || tx.name}`}
      // 44pt to touch (M-16).
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      style={({ pressed }) => [styles.largest, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.sub, styles.shrink, { color: ink }]} numberOfLines={1}>
        Largest {amount}
      </Text>
      <SymbolView name="chevron.right" size={icon.xs} weight="bold" tintColor={ink} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/**
 * Money in and money out over the whole filter match (server summed, not just
 * the loaded page), each in its tile, then the count, the dates and the net.
 * See shownSides for which figures show.
 */
function SummaryStripBase({
  summary,
  kind,
  onOpenTx,
  hidden: _hidden,
}: {
  summary: TxnQuerySummary;
  kind: TxnFilters["kind"];
  onOpenTx: (tx: TxnQueryRow) => void;
  /** Re-renders the strip when amounts hide. */
  hidden: boolean;
}) {
  const t = useTheme();
  const k = kpiFigures(summary, { whole: true });
  const range = summaryRangeLabel(summary.earliest, summary.latest);
  const show = shownSides(summary, kind);
  const wide = useWindowDimensions().fontScale > STACK_FONT_SCALE;
  const skin = useDesign().skin.summary;
  const count = `${k.count} ${summary.count === 1 ? "transaction" : "transactions"}`;
  // The `card` skin: one card of four figures (count, in, out, net), each a cell.
  if (skin === "card") {
    return (
      <Card style={styles.strip}>
        <Cell label="Transactions" value={k.count} wide={wide} sub={range ? <Text style={[styles.sub, { color: t.contentMuted }]}>{range}</Text> : null} />
        {show.moneyIn ? (
          <Cell label="Money in" value={k.moneyIn} tone="pos" wide={wide} sub={summary.largestCredit ? <Largest tx={summary.largestCredit} onOpen={onOpenTx} link /> : null} />
        ) : null}
        {show.moneyOut ? (
          <Cell label="Money out" value={k.moneyOut} wide={wide} sub={summary.largestDebit ? <Largest tx={summary.largestDebit} onOpen={onOpenTx} link /> : null} />
        ) : null}
        {show.net ? <Cell label="Net" value={k.net} tone={k.netTone} wide={wide} /> : null}
      </Card>
    );
  }
  // No side to show (Transfers: they move money between your own accounts, so neither side counts them):
  // one plain tile with the count and the dates, so the page still opens on a summary, not a stray line.
  if (!show.moneyIn && !show.moneyOut) {
    return (
      <Card style={styles.tile}>
        <View accessible accessibilityLabel={`${kind === "transfer" ? "Transfers" : "Transactions"}, ${k.count}${range ? `, ${range}` : ""}`}>
          <Text style={[styles.label, { color: t.contentMuted }]}>{kind === "transfer" ? "Transfers" : "Transactions"}</Text>
          <Text style={[styles.value, { color: t.content }]} numberOfLines={1} adjustsFontSizeToFit>
            {k.count}
          </Text>
          {range ? <Text style={[styles.sub, { color: t.contentMuted }]}>{range}</Text> : null}
        </View>
      </Card>
    );
  }
  // Transactions' hero: the two sides as tinted tiles, then the count, the dates and the net under them.
  return (
    <View style={styles.hero}>
      <View style={[styles.tiles, wide && { flexDirection: "column" }]}>
        {show.moneyIn ? <Tile label="Money in" value={k.moneyIn} tone="pos" largest={summary.largestCredit ?? null} onOpen={onOpenTx} wide={wide} /> : null}
        {show.moneyOut ? <Tile label="Money out" value={k.moneyOut} tone="neg" largest={summary.largestDebit ?? null} onOpen={onOpenTx} wide={wide} /> : null}
      </View>
      <Text style={[styles.meta, { color: t.contentMuted }]}>
        {range ? `${count}, ${range}.` : `${count}.`}
        {show.net ? (
          <>
            {" "}Net <Text style={[styles.metaFigure, { color: toneColor(t, k.net, k.netTone) }]}>{k.net}</Text>
          </>
        ) : null}
      </Text>
    </View>
  );
}

export const SummaryStrip = memo(SummaryStripBase);

/** The same figures on one line, pinned under the nav bar once the strip has scrolled away. */
function SummaryLineBase({ summary, kind, hidden: _hidden }: { summary: TxnQuerySummary; kind: TxnFilters["kind"]; hidden: boolean }) {
  const t = useTheme();
  const k = kpiFigures(summary, { whole: true });
  const show = shownSides(summary, kind);
  const item = (label: string, value: string, tone?: Tone) => (
    <Text style={[styles.lineItem, { color: t.contentMuted }]} numberOfLines={1} maxFontSizeMultiplier={LINE_MAX_SCALE}>
      {label} <Text style={[styles.lineValue, { color: toneColor(t, value, tone) }]}>{value}</Text>
    </Text>
  );
  // Must never clip: a cut-off figure reads as a different number. The count drops out first.
  return (
    <View style={styles.line}>
      {show.moneyIn ? item("In", k.moneyIn, "pos") : null}
      {show.moneyOut ? item("Out", k.moneyOut) : null}
      {show.net ? item("Net", k.net, k.netTone) : null}
    </View>
  );
}

export const SummaryLine = memo(SummaryLineBase);

export const SUMMARY_LINE_HEIGHT = 36;

// The pinned line is bar chrome with a fixed height, so like the nav bar's own text it stops growing early.
const LINE_MAX_SCALE = 1.15;

const styles = themedStyles(() => StyleSheet.create({
  tiles: { flexDirection: "row", gap: 10 },
  strip: { flexDirection: "row", flexWrap: "wrap", padding: 0 },
  cell: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  cellLabel: { ...type.footnote, ...weight.semibold },
  tile: { paddingHorizontal: TILE_INSET, paddingVertical: 12, gap: 2 },
  label: { ...type.footnote, ...weight.semibold },
  value: { ...type.amount },
  sub: { ...type.footnote, ...weight.semibold },
  shrink: { flexShrink: 1 },
  largest: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", minHeight: 20, marginTop: 2 },
  hero: { gap: 8 },
  meta: { ...type.footnote, paddingHorizontal: TILE_INSET, paddingBottom: 4 },
  metaFigure: { ...figures },
  line: { height: SUMMARY_LINE_HEIGHT, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: space.screen + space.rowInset },
  lineItem: { ...type.footnote },
  lineValue: { ...figures },
}));
