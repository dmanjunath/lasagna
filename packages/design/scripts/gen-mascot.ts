// Writes src/mascot/generated.ts from the .svg files beside it, so React Native
// (which cannot import an .svg) gets the same artwork as string constants.
// The .svg files are the source of truth. Run: pnpm -F @lasagna/design gen:mascot
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MASCOT_NAMES, renderMascotModule } from "../src/mascot/source";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/mascot");
const sources = Object.fromEntries(MASCOT_NAMES.map((n) => [n, readFileSync(join(dir, `${n}.svg`), "utf8")]));
writeFileSync(join(dir, "generated.ts"), renderMascotModule(sources));
console.log("wrote src/mascot/generated.ts");
