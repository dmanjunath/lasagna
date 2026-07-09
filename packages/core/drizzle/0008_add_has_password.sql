-- Passwordless auth: users.has_password drives the two-step login Step-1 branch.
-- Hand-authored (drizzle-kit generate is blocked by unrelated pre-existing enum
-- drift). IF NOT EXISTS keeps it safe whether prod gets it via db:migrate or a
-- manual ALTER hotfix.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_password" boolean DEFAULT false NOT NULL;
