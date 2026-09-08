/**
 * Creates the App Review sign-in account: a normal owner account with preset
 * data and a password, so a reviewer who cannot read our email can still sign
 * in and exercise the app, deletion included.
 *
 * It is deliberately NOT a demo account. `isDemo` makes both deletion endpoints
 * answer 403, and deletion is the one thing Apple checks when the listing says
 * the app supports it.
 *
 * Run via: REVIEW_EMAIL=… REVIEW_PASSWORD=… pnpm -F @lasagna/core db:seed-review
 * The password is never printed, so this is safe to run in CI logs.
 */
import { createDb } from "../db.js";
import { users } from "../schema.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "./utils.js";
import { PRESETS } from "./presets.js";
import { seedPresetAccount } from "./seed-account.js";

const DATABASE_URL = process.env.DATABASE_URL;
const REVIEW_EMAIL = process.env.REVIEW_EMAIL?.trim().toLowerCase();
const REVIEW_PASSWORD = process.env.REVIEW_PASSWORD;
// Matches the preset profile's name, so the greeting and the sidebar agree.
// "App Review" made the dashboard open with "Good morning, App".
const REVIEW_NAME = process.env.REVIEW_NAME?.trim() || "Taylor";
const REVIEW_PRESET = process.env.REVIEW_PRESET?.trim() || "1.8M";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!REVIEW_EMAIL || !REVIEW_PASSWORD) {
  console.error("REVIEW_EMAIL and REVIEW_PASSWORD are required");
  process.exit(1);
}
if (!(REVIEW_PRESET in PRESETS)) {
  console.error(`REVIEW_PRESET must be one of: ${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

const db = createDb(DATABASE_URL);

async function seedReview() {
  // Refuse rather than reset. This runs against production, where overwriting
  // the password of an address that turns out to belong to somebody real is not
  // a mistake that can be taken back.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, REVIEW_EMAIL!));

  if (existing) {
    console.error(
      `An account already exists for ${REVIEW_EMAIL}. Delete it in the app first, ` +
        `or pass a different REVIEW_EMAIL. Nothing was changed.`,
    );
    process.exit(1);
  }

  const { tenantId, userId } = await seedPresetAccount(db, REVIEW_PRESET);

  await db
    .update(users)
    .set({
      email: REVIEW_EMAIL!,
      name: REVIEW_NAME,
      passwordHash: await hashPassword(REVIEW_PASSWORD!),
      // Drives the password branch of two-step login and of deletion re-auth.
      hasPassword: true,
      isDemo: false,
      isAdmin: false,
      acceptedTermsAt: new Date(),
    })
    .where(eq(users.id, userId));

  console.log(
    `Review account created: ${REVIEW_EMAIL} (preset ${REVIEW_PRESET}, tenantId: ${tenantId})`,
  );
}

// The postgres.js pool holds the process open, which would hang a CI job rather
// than fail it, so the connection is closed explicitly on both paths.
seedReview()
  .then(() => db.$client.end())
  .catch(async (err) => {
    console.error("Failed to seed the review account:", err);
    await db.$client.end().catch(() => {});
    process.exit(1);
  });
