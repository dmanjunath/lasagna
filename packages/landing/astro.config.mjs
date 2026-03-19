import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  // applyBaseStyles: false is required with @astrojs/tailwind v5 so it does not
  // inject its own CSS — we import global.css explicitly in Layout.astro instead.
  integrations: [tailwind({ applyBaseStyles: false })],
});
