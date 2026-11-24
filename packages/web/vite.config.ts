import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { themes } from "../design/src/registry";
import { designBoot, themeCss } from "../design/src/build/webCss";

// The web's own look (theme.css) is the Classic design. Every other design
// system ships as one stylesheet scoped to html[data-design="<id>"], built from
// packages/design so it can never drift from the native app's theme, and the
// first-paint script in index.html learns each design's fonts and assistant.
const webDesigns = themes.filter((t) => t.meta.id !== "classic");
const DESIGNS_CSS = "virtual:lf-designs.css";

function lfDesigns(): Plugin {
  return {
    name: "lf-designs",
    resolveId: (id) => (id === DESIGNS_CSS ? "\0" + DESIGNS_CSS : null),
    load: (id) => (id === "\0" + DESIGNS_CSS ? webDesigns.map(themeCss).join("\n") : null),
    transformIndexHtml: (html) => html.replace("__LF_DESIGNS__", JSON.stringify(designBoot(webDesigns))),
  };
}

export default defineConfig({
  plugins: [
    react(),
    lfDesigns(),
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
      // Same reason for the retirement verdict: "on track" is defined once, in
      // core, so the path and the retirement page cannot judge the same success
      // rate differently.
      "@lasagna/core/retirement-verdict": fileURLToPath(
        new URL("../core/src/retirement-verdict.ts", import.meta.url),
      ),
      // The design systems (themes, mascot art) the native app is drawn with.
      "@lasagna/design/build/webCss": fileURLToPath(new URL("../design/src/build/webCss.ts", import.meta.url)),
      "@lasagna/design": fileURLToPath(new URL("../design/src/index.ts", import.meta.url)),
      // And the payoff math: one schedule for the debt page and the journey.
      "@lasagna/core/debt-payoff": fileURLToPath(
        new URL("../core/src/debt-payoff.ts", import.meta.url),
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
