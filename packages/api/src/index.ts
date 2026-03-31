import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app } from "./server.js";

// In production, serve the built web assets
if (process.env.NODE_ENV === "production") {
  app.use("*", serveStatic({ root: "./packages/web/dist" }));
  // SPA fallback — serve index.html for non-API routes
  app.get("*", serveStatic({ root: "./packages/web/dist", path: "index.html" }));
}

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Lasagna API running on http://localhost:${info.port}`);
});
