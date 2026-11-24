// Writes each design's icon tile (favicon SVG + 180px touch PNG) into public/icons from
// @lasagna/design iconTileSvg. Run after a mascot or brand color change:
//   npx tsx packages/web/scripts/gen-design-icons.mts
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { themes } from "../../design/src/registry.ts";
import { iconTileSvg, designIcons } from "../../design/src/build/webCss.ts";
const pub = new URL("../public", import.meta.url).pathname;
const b = await chromium.launch();
for (const t of themes) {
  const svg = iconTileSvg(t, 180); const paths = designIcons(t);
  if (!svg || !paths) continue;
  writeFileSync(pub + paths.svg, svg + "\n");
  // The home-screen icon is square and opaque: iOS rounds it itself and fills
  // any transparent corner with black.
  const square = svg.replace(/(<rect width="180" height="180") rx="[^"]+"/, '$1 rx="0"');
  const p = await b.newPage({ viewport: { width: 180, height: 180 } });
  await p.setContent(`<html><body style="margin:0">${square}</body></html>`);
  await p.screenshot({ path: pub + paths.touch, omitBackground: false, clip: { x: 0, y: 0, width: 180, height: 180 } });
  console.log("wrote", paths.svg, paths.touch);
}
await b.close();
