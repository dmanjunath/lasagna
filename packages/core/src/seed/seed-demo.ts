/**
 * Creates the demo user (demo@lasagnafi.com / lasagna123) with the 1.8M Taylor preset.
 * Idempotent: if the user already exists, only ensures isDemo=true.
 * Run via: pnpm db:seed-demo
 */
import { createDb } from "../db.js";
import { users } from "../schema.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "./utils.js";
import { seedPresetAccount } from "./seed-account.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(DATABASE_URL);

const DEMO_EMAIL = "demo@lasagnafi.com";
const DEMO_PASSWORD = "lasagna123";

async function seedDemo() {
  // Idempotency check
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL));

  if (existing) {
    await db
      .update(users)
      .set({ isDemo: true, acceptedTermsAt: new Date() })
      .where(eq(users.email, DEMO_EMAIL));
    console.log("Demo user already exists. Ensured isDemo=true.");
    return;
  }

  const { tenantId, userId } = await seedPresetAccount(db, "1.8M");

  // Override generated email/password and set isDemo flag
  await db
    .update(users)
    .set({
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      isDemo: true,
      acceptedTermsAt: new Date(),
    })
    .where(eq(users.id, userId));

  console.log(`Demo user created: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (tenantId: ${tenantId})`);
}

seedDemo().catch((err) => {
  console.error("Failed to seed demo user:", err);
  process.exit(1);
});
