import { serve } from "@hono/node-server";
import { app } from "./server.js";

const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Lasagna API running on http://localhost:${info.port}`);
});
