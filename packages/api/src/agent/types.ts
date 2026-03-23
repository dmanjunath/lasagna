import { z } from "zod";

// ── UI Block Schemas ──────────────────────────────────────────────────────

export const statBlockSchema = z.object({
  type: z.literal("stat"),
  label: z.string(),
  value: z.string(),
  change: z.string().optional(),
  trend: z.enum(["up", "down", "neutral"]).optional(),
  description: z.string().optional(),
});

export const dataPointSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const chartBlockSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["area", "bar", "donut"]),
  title: z.string().optional(),
  data: z.array(dataPointSchema),
});

export const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
});

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  // Accept either columns (structured) or headers (simple string array)
  columns: z.array(columnSchema).optional(),
  headers: z.array(z.string()).optional(),
  // Accept rows as either records or arrays (AI sometimes generates arrays)
  rows: z.array(
    z.union([
      z.record(z.string(), z.union([z.string(), z.number()])),
      z.array(z.union([z.string(), z.number()])),
    ])
  ),
});

export const textBlockSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
  variant: z.enum(["prose", "callout"]).optional(),
});

export const scenarioSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

export const projectionBlockSchema = z.object({
  type: z.literal("projection"),
  title: z.string().optional(),
  description: z.string().optional(),
  scenarios: z.array(scenarioSchema),
});

export const actionBlockSchema = z.object({
  type: z.literal("action"),
  // Support both formats: simple (label/action) and rich (title/description/actions)
  label: z.string().optional(),
  action: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  actions: z.array(z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const uiBlockSchema = z.discriminatedUnion("type", [
  statBlockSchema,
  chartBlockSchema,
  tableBlockSchema,
  textBlockSchema,
  projectionBlockSchema,
  actionBlockSchema,
]);

export const uiPayloadSchema = z.object({
  layout: z.enum(["single", "split", "grid"]),
  blocks: z.array(uiBlockSchema),
});

// ── TypeScript Types ──────────────────────────────────────────────────────

export type StatBlock = z.infer<typeof statBlockSchema>;
export type ChartBlock = z.infer<typeof chartBlockSchema>;
export type TableBlock = z.infer<typeof tableBlockSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ProjectionBlock = z.infer<typeof projectionBlockSchema>;
export type ActionBlock = z.infer<typeof actionBlockSchema>;
export type UIBlock = z.infer<typeof uiBlockSchema>;
export type UIPayload = z.infer<typeof uiPayloadSchema>;
