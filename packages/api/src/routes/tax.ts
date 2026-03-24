import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { taxReturns, taxDocuments, eq, and, desc } from "@lasagna/core";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const taxRouter = new Hono<AuthEnv>();
taxRouter.use("*", requireAuth);

// Validation schemas
const uuidSchema = z.string().uuid();

const createTaxReturnSchema = z.object({
  taxYear: z.number().int().min(1900).max(2100),
  filingStatus: z.enum(["single", "married_joint", "married_separate", "head_of_household"]).optional(),
});

const addDocumentSchema = z.object({
  documentType: z.string().min(1).max(50),
  extractedData: z.record(z.string(), z.unknown()),
});

const updateDocumentSchema = z.object({
  extractedData: z.record(z.string(), z.unknown()),
});

// Helper to parse extractedData JSON string
function parseDocument(doc: typeof taxDocuments.$inferSelect) {
  return {
    ...doc,
    extractedData: doc.extractedData ? JSON.parse(doc.extractedData) : null,
  };
}

// Get all tax returns for tenant
taxRouter.get("/returns", async (c) => {
  const { tenantId } = c.get("session");

  const returns = await db
    .select()
    .from(taxReturns)
    .where(eq(taxReturns.tenantId, tenantId))
    .orderBy(desc(taxReturns.taxYear));

  return c.json({ returns });
});

// Get single tax return with documents
taxRouter.get("/returns/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(id);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid tax return ID format" }, 400);
  }

  const [taxReturn] = await db
    .select()
    .from(taxReturns)
    .where(and(eq(taxReturns.id, id), eq(taxReturns.tenantId, tenantId)));

  if (!taxReturn) {
    return c.json({ error: "Tax return not found" }, 404);
  }

  const documents = await db
    .select()
    .from(taxDocuments)
    .where(and(eq(taxDocuments.taxReturnId, id), eq(taxDocuments.tenantId, tenantId)));

  return c.json({ taxReturn, documents: documents.map(parseDocument) });
});

// Create tax return
taxRouter.post("/returns", async (c) => {
  const { tenantId } = c.get("session");
  const rawBody = await c.req.json();

  const parseResult = createTaxReturnSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: "Invalid request body", details: parseResult.error.issues },
      400
    );
  }
  const body = parseResult.data;

  const [taxReturn] = await db
    .insert(taxReturns)
    .values({
      tenantId,
      taxYear: body.taxYear,
      filingStatus: body.filingStatus || null,
    })
    .returning();

  return c.json({ taxReturn }, 201);
});

// Add document to tax return
taxRouter.post("/returns/:id/documents", async (c) => {
  const { tenantId } = c.get("session");
  const taxReturnId = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(taxReturnId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid tax return ID format" }, 400);
  }

  // Verify tax return exists and belongs to tenant
  const [taxReturn] = await db
    .select({ id: taxReturns.id })
    .from(taxReturns)
    .where(and(eq(taxReturns.id, taxReturnId), eq(taxReturns.tenantId, tenantId)));

  if (!taxReturn) {
    return c.json({ error: "Tax return not found" }, 404);
  }

  const rawBody = await c.req.json();
  const parseResult = addDocumentSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: "Invalid request body", details: parseResult.error.issues },
      400
    );
  }
  const body = parseResult.data;

  const [document] = await db
    .insert(taxDocuments)
    .values({
      taxReturnId,
      tenantId,
      documentType: body.documentType,
      extractedData: JSON.stringify(body.extractedData),
      extractedAt: new Date(),
    })
    .returning();

  return c.json({ document: parseDocument(document) }, 201);
});

// Update document (for manual edits)
taxRouter.patch("/documents/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(id);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid document ID format" }, 400);
  }

  const rawBody = await c.req.json();
  const parseResult = updateDocumentSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: "Invalid request body", details: parseResult.error.issues },
      400
    );
  }
  const body = parseResult.data;

  const [document] = await db
    .update(taxDocuments)
    .set({ extractedData: JSON.stringify(body.extractedData) })
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)))
    .returning();

  if (!document) {
    return c.json({ error: "Document not found" }, 404);
  }

  return c.json({ document: parseDocument(document) });
});

// Delete document
taxRouter.delete("/documents/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(id);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid document ID format" }, 400);
  }

  await db
    .delete(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  return c.json({ success: true });
});
