import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      // The goal-target calculator is shared with the API so the number the
      // form shows and the number the server stores can never disagree. Point
      // at the source so the dev server and the bundle both read it directly,
      // without dragging the rest of @lasagna/core (and its DB driver) in.
      "@lasagna/core/goal-target": fileURLToPath(
        new URL("../core/src/goal-target.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": process.env.VITE_API_PROXY_TARGET || "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
  },
});
