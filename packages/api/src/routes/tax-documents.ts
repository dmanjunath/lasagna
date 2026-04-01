import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { taxDocuments, eq, and, desc } from "@lasagna/core";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { processDocument } from "../lib/tax-extraction.js";
import { deleteFile } from "../lib/gcs.js";

export const taxDocumentsRouter = new Hono<AuthEnv>();

taxDocumentsRouter.use("*", requireAuth);

// Upload + process document
taxDocumentsRouter.post("/upload", async (c) => {
  const { tenantId } = c.get("session");
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || !(file instanceof File)) {
    return c.json({ error: "File is required" }, 400);
  }

  try {
    const result = await processDocument(tenantId, file);
    return c.json(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    if (message.includes("Unsupported file type") || message.includes("File too large")) {
      return c.json({ error: message }, 400);
    }
    console.error("Document processing failed:", error);
    return c.json({ error: "Document processing failed" }, 500);
  }
});

// List documents
taxDocumentsRouter.get("/", async (c) => {
  const { tenantId } = c.get("session");

  const docs = await db
    .select({
      id: taxDocuments.id,
      fileName: taxDocuments.fileName,
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
    .select({ gcsPath: taxDocuments.gcsPath })
    .from(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  if (!doc) return c.json({ error: "Document not found" }, 404);

  await db
    .delete(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  // Best-effort GCS cleanup
  await deleteFile(doc.gcsPath);

  return c.json({ success: true });
});
