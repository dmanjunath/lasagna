import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const drizzleDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

function read0014Sql(): string {
  const files = readdirSync(drizzleDir)
    .filter((f) => f.startsWith("0014") && f.endsWith(".sql"))
    .sort();
  assert.ok(files.length > 0, "expected a 0014_*.sql migration to exist");
  return files.map((f) => readFileSync(join(drizzleDir, f), "utf8")).join("\n");
}

describe("0014 household-sharing migration", () => {
  it("adds the viewer role, invites + user_profiles tables, and chat_threads.user_id", () => {
    const sql = read0014Sql();
    assert.match(sql, /ALTER TYPE ("public"\.)?"role" ADD VALUE 'viewer'/);
    assert.match(sql, /CREATE TABLE "invites"/);
    assert.match(sql, /CREATE TABLE "user_profiles"/);
    assert.match(sql, /ALTER TABLE "chat_threads" ADD COLUMN "user_id"/);
  });

  it("backfills the owner's personal profile and owner chat ownership", () => {
    const sql = read0014Sql();
    assert.match(sql, /INSERT INTO "user_profiles"/);
    assert.match(sql, /UPDATE "chat_threads"[\s\S]*owner/i);
  });

  it("enforces at most one pending invite per (tenant, email) via a partial-unique index", () => {
    const sql = read0014Sql();
    assert.match(sql, /"?accepted_at"? IS NULL AND (?:"invites"\.)?"?revoked_at"? IS NULL/);
  });
});
