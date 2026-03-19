import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { taxDocuments, eq, and, desc } from "@lasagna/core";
import { type AuthEnv } from "../middleware/auth.js";
import { extractFromVision } from "../lib/tax-vision-extraction.js";
import { generateInsights } from "../lib/insights-engine.js";

export const taxDocumentsRouter = new Hono<AuthEnv>();

// Vision-based extraction (file or text input)
taxDocumentsRouter.post("/", async (c) => {
  const { tenantId } = c.get("session");
  const body = await c.req.parseBody();
  const file = body.file;
  const text = body.text;
  const providerUrl = body.providerUrl;
  const apiKey = body.apiKey;
  const model = body.model;

  // Check for file or text input
  if (!file && !text) {
    return c.json({ error: "Either file or text is required" }, 400);
  }

  // File path
  if (file && file instanceof File) {
    if (!providerUrl) {
      return c.json({ error: "providerUrl is required for file uploads" }, 400);
    }

    try {
      const fileBuffer = await file.arrayBuffer();
      const extraction = await extractFromVision(
        Buffer.from(fileBuffer),
        file.type,
        typeof providerUrl === "string" ? providerUrl : "",
        {
          apiKey: apiKey && typeof apiKey === "string" && apiKey.trim() ? apiKey : undefined,
          model: model && typeof model === "string" && model.trim() ? model : undefined,
        }
      );

      const docs = await db
        .insert(taxDocuments)
        .values(
          extraction.documents.map((doc) => ({
            tenantId,
            fileName: file.name,
            fileType: file.type,
            gcsPath: "",
            rawExtraction: [],
            llmFields: { ...doc.fields, document_type: doc.type },
            llmSummary: doc.description,
            taxYear: doc.year,
          }))
        )
        .returning();

      // Regenerate insights in background with new document data
      generateInsights(tenantId).catch((e) =>
        console.error("Background insights generation failed:", e)
      );

      return c.json({ documents: docs }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Extraction failed";
      if (
        message.includes("Unsupported file type") ||
        message.includes("File too large")
      ) {
        return c.json({ error: message }, 400);
      }
      console.error("Vision extraction failed:", error);
      return c.json(
        { error: "Extraction failed", raw: message },
        422
      );
    }
  }

  // Text path
  if (text && typeof text === "string" && text.trim()) {
    try {
      const docs = await db
        .insert(taxDocuments)
        .values({
          tenantId,
          fileName: "manual-entry",
          fileType: "text/plain",
          gcsPath: "",
          rawExtraction: [],
          llmFields: {},
          llmSummary: text,
          taxYear: null,
        })
        .returning();

      // Regenerate insights in background with new document data
      generateInsights(tenantId).catch((e) =>
        console.error("Background insights generation failed:", e)
      );

      return c.json({ documents: docs }, 201);
    } catch (error) {
      console.error("Document insertion failed:", error);
      return c.json({ error: "Document processing failed" }, 500);
    }
  }

  // Should not reach here if either file or text is validated above
  return c.json({ error: "Either file or text is required" }, 400);
});

// List documents
taxDocumentsRouter.get("/", async (c) => {
  const { tenantId } = c.get("session");

  const docs = await db
    .select({
      id: taxDocuments.id,
      fileName: taxDocuments.fileName,
      llmFields: taxDocuments.llmFields,
      llmSummary: taxDocuments.llmSummary,
      taxYear: taxDocuments.taxYear,
      createdAt: taxDocuments.createdAt,
    })
    .from(taxDocuments)
    .where(eq(taxDocuments.tenantId, tenantId))
    .orderBy(desc(taxDocuments.createdAt));

  return c.json({ documents: docs });
});

// Get single document
taxDocumentsRouter.get("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");

  const [doc] = await db
    .select()
    .from(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json({ document: doc });
});

// Update tax year
taxDocumentsRouter.patch("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json();

  const schema = z.object({
    taxYear: z.number().int().min(1900).max(2100).nullable().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues }, 400);
  }

  const [doc] = await db
    .update(taxDocuments)
    .set(parsed.data)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)))
    .returning();

  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json({ document: doc });
});

// Delete document
taxDocumentsRouter.delete("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");

  const [doc] = await db
    .select({ id: taxDocuments.id })
    .from(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  if (!doc) return c.json({ error: "Document not found" }, 404);

  await db
    .delete(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  // Regenerate insights in background after document removal
  generateInsights(tenantId).catch((e) =>
    console.error("Background insights generation failed:", e)
  );

  return c.json({ success: true });
});
