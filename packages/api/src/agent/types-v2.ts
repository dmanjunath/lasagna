import { z } from 'zod';

export const metricSchema = z.object({
  label: z.string(),
  value: z.string(),
  context: z.string().optional(),
});

export const responseSchemaV2 = z.object({
  chat: z.string(), // Brief conversational response for chat sidebar
  metrics: z.array(metricSchema).optional(),
  content: z.string(), // Full structured content for main page
  actions: z.array(z.string()).optional(),
});

export type MetricV2 = z.infer<typeof metricSchema>;
export type ResponseV2 = z.infer<typeof responseSchemaV2>;
