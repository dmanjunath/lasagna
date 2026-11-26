// Builds the Expo Updates manifest for one exported update (OTA.md), in the
// shape the protocol asks for: the launch asset (the Hermes bundle) and every
// other asset, each with a base64url SHA-256 hash, an MD5 key and its URL in
// the bucket. The id and createdAt are stamped later, at publish time, so
// republishing an older update (a rollback) still reads as the newest one.
//
// Usage: node ota-manifest.mjs <exportDir> <assetBaseUrl> <runtimeVersion> <commit> <expoConfig.json>
/* global process, console */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, baseUrl, runtimeVersion, commit, configPath] = process.argv.slice(2);
if (!dir || !baseUrl || !runtimeVersion || !commit || !configPath) {
  console.error("usage: ota-manifest.mjs <exportDir> <assetBaseUrl> <runtimeVersion> <commit> <expoConfig.json>");
  process.exit(1);
}

const TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  json: "application/json",
};

function asset(path, ext, launch) {
  const bytes = readFileSync(join(dir, path));
  return {
    hash: createHash("sha256").update(bytes).digest("base64url"),
    key: createHash("md5").update(bytes).digest("hex"),
    contentType: launch ? "application/javascript" : (TYPES[ext] ?? "application/octet-stream"),
    ...(launch ? {} : { fileExtension: `.${ext}` }),
    url: `${baseUrl.replace(/\/$/, "")}/${path}`,
  };
}

const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")).fileMetadata.ios;
const expoClient = JSON.parse(readFileSync(configPath, "utf8"));

const manifest = {
  runtimeVersion,
  launchAsset: asset(meta.bundle, "hbc", true),
  assets: meta.assets.map((a) => asset(a.path, a.ext, false)),
  metadata: {},
  extra: { expoClient, commit },
};
process.stdout.write(JSON.stringify(manifest));
