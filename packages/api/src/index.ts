import { serve } from "@hono/node-server";
import { app } from "./server.js";
import { startCronJobs } from "./lib/cron.js";
import { env } from "./lib/env.js";

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Lasagna API running on http://localhost:${info.port}`);
  // Say which tenancy mode actually resolved. Single-tenant makes every signup
  // an operator, so it must be visible in the boot log rather than inferred
  // from config nobody re-reads.
  console.log(
    env.MULTI_TENANT
      ? "Tenancy: multi-tenant. Signup never grants admin."
      : "Tenancy: SINGLE-TENANT (MULTI_TENANT=false). Every new signup becomes an admin.",
  );
  startCronJobs();
});
