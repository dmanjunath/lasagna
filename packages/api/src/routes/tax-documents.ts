import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { taxDocuments, eq, and, desc } from "@lasagna/core";
import { type AuthEnv } from "../middleware/auth.js";
import { extractFromVision } from "../lib/tax-vision-extraction.js";
import { readTaxSummary } from "../lib/tax-summary.js";
import { visionProvider } from "../lib/vision/index.js";

export const taxDocumentsRouter = new Hono<AuthEnv>();

// Vision-based extraction (file or text input)
taxDocumentsRouter.post("/", async (c) => {
  const { tenantId } = c.get("session");
  const body = await c.req.parseBody();
  const file = body.file;
  const text = body.text;

  // Check for file or text input
  if (!file && !text) {
    return c.json({ error: "Either file or text is required" }, 400);
  }

  // File path
  if (file && file instanceof File) {
    // Resolving the provider fails for deploy reasons (bad VISION_PROVIDER, no
    // credentials), not because of this document. Keep it out of the extraction
    // catch so the user isn't told their file is bad, and don't return the
    // internal message, which names IAM roles and env vars.
    let provider, target;
    try {
      provider = visionProvider();
      target = await provider.resolve();
    } catch (error) {
      console.error("Vision provider misconfigured:", error);
      return c.json({ error: "Document extraction is unavailable right now." }, 500);
    }
    if (provider.sendsDocumentsOffProject) {
      console.warn(
        `[Vision Extraction] provider "${provider.name}" sends tax documents off-project`
      );
    }

    try {
      const fileBuffer = await file.arrayBuffer();
      const extraction = await extractFromVision(
        Buffer.from(fileBuffer),
        file.type,
        target.url,
        { apiKey: target.apiKey, model: target.model, tenantId }
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
        { error: "We couldn't read that document. Try a clearer scan or photo." },
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

// Plain-language description of what the uploaded documents show. MUST stay
// above GET /:id, which would otherwise match "summary" as a document id.
// Generation is lazy and fingerprinted, so this is a cheap read unless the
// documents changed.
taxDocumentsRouter.get("/summary", async (c) => {
  const { tenantId } = c.get("session");
  const { summary, generatedAt } = await readTaxSummary(tenantId);
  return c.json({ summary, generatedAt });
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

  return c.json({ success: true });
});
