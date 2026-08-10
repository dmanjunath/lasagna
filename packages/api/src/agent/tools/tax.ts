import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { taxDocuments, eq, desc } from "@lasagna/core";

export function createTaxTools(tenantId: string) {
  return {
    get_tax_documents: tool({
      description:
        "Get the user's uploaded tax documents with extracted fields and summaries. Use this to answer questions about W-2s, 1099s, 1040s, K-1s, and other tax forms.",
      inputSchema: z.object({
        taxYear: z
          .number()
          .int()
          .optional()
          .describe("Filter by tax year (e.g., 2024). Omit to get all years."),
      }),
      execute: async ({ taxYear }) => {
        const conditions = [eq(taxDocuments.tenantId, tenantId)];

        const rows = await db
          .select({
            id: taxDocuments.id,
            fileName: taxDocuments.fileName,
            taxYear: taxDocuments.taxYear,
            llmFields: taxDocuments.llmFields,
            llmSummary: taxDocuments.llmSummary,
            createdAt: taxDocuments.createdAt,
          })
          .from(taxDocuments)
          .where(eq(taxDocuments.tenantId, tenantId))
          .orderBy(desc(taxDocuments.taxYear), desc(taxDocuments.createdAt));

        const filtered = taxYear
          ? rows.filter((r) => r.taxYear === taxYear)
          : rows;

        if (filtered.length === 0) {
          return {
            documents: [],
            message: taxYear
              ? `No tax documents found for tax year ${taxYear}.`
              : "No tax documents uploaded yet.",
          };
        }

        return {
          documents: filtered.map((d) => ({
            id: d.id,
            fileName: d.fileName,
            taxYear: d.taxYear,
            fields: d.llmFields,
            summary: d.llmSummary,
            uploadedAt: d.createdAt,
          })),
          count: filtered.length,
        };
      },
    }),
  };
}
