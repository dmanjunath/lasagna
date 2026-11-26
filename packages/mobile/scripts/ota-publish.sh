#!/usr/bin/env bash
# Publishes an over-the-air update of the React Native app, keyed by commit
# sha (OTA.md). This is the only thing that writes the app's updates to the
# OTA bucket. Nothing there is edited by hand.
#
# An update reaches only builds with the same runtime version, a fingerprint
# of the native code and app config, printed below and by ios-archive.sh. A
# change that needs a new App Store build gets a new runtime version, so it
# can never be pushed to a build that cannot run it.
#
# Publishing an EARLIER sha is how a rollback works. A sha that was published
# before is reused, so only the pointer moves and it lands in seconds. Each
# publish is stamped with a new id and time, so devices take it in either
# direction. OTA_ROLLBACK_TO_EMBEDDED=1 sends every device back to the bundle
# its build shipped with.
#
# Config comes from the environment (lasagna-infra/ios/signing.env locally,
# GitHub variables in CI). This repo is public and carries no real values:
#   OTA_BUCKET, VITE_API_URL, MOBILE_WEB_URL, OTA_CODE_SIGNING_CERT_FILE
# For a local end-to-end test, OTA_LOCAL_DIR and OTA_LOCAL_BASE_URL publish to
# a folder served over http instead of the bucket.
# Usage: pnpm -F @lasagna/mobile ota:publish [<sha>]     (defaults to HEAD)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/../.." && pwd)"
INFRA_ENV="${LASAGNA_IOS_SIGNING_ENV:-$REPO_DIR/../lasagna-infra/ios/signing.env}"
if [[ -f "$INFRA_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$INFRA_ENV"
fi
: "${VITE_API_URL:?VITE_API_URL not set}"
: "${MOBILE_WEB_URL:?MOBILE_WEB_URL not set}"
# shellcheck disable=SC1091
source "$APP_DIR/scripts/ota-env.sh"
if [[ -z "${EXPO_UPDATES_URL:-}" ]]; then
  echo "REFUSING: no code-signing certificate (OTA_CODE_SIGNING_CERT_FILE), so builds would reject this update." >&2
  exit 1
fi

SHA=$(git -C "$REPO_DIR" rev-parse "${1:-HEAD}")
# The update is built from the working tree but stored under a sha. If the tree
# is dirty those disagree, and the sha stops identifying its own contents,
# which the fast path and every rollback rely on.
if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" && "${OTA_ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "REFUSING: working tree is dirty, so the update would not match $SHA." >&2
  echo "Commit first, or set OTA_ALLOW_DIRTY=1 for a throwaway local test." >&2
  exit 1
fi

RUNTIME=$(cd "$APP_DIR" && npx expo-updates runtimeversion:resolve --platform ios \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).runtimeVersion')
PREFIX="rn/ios/$RUNTIME"
echo "==> $SHA for runtime version $RUNTIME"
echo "    Only builds that printed this runtime version will take it."

# --- Where it goes: the bucket, or a local folder for a test. ----------------
if [[ -n "${OTA_LOCAL_DIR:-}" ]]; then
  : "${OTA_LOCAL_BASE_URL:?OTA_LOCAL_BASE_URL not set}"
  BASE_URL="${OTA_LOCAL_BASE_URL%/}"
  exists() { [[ -e "$OTA_LOCAL_DIR/$1" ]]; }
  fetch() { cat "$OTA_LOCAL_DIR/$1"; }
  put_tree() { mkdir -p "$OTA_LOCAL_DIR/$2" && cp -R "$1/." "$OTA_LOCAL_DIR/$2/"; }
  put_file() { mkdir -p "$(dirname "$OTA_LOCAL_DIR/$2")" && cp "$1" "$OTA_LOCAL_DIR/$2"; }
else
  : "${OTA_BUCKET:?OTA_BUCKET not set}"
  BASE_URL="https://storage.googleapis.com/$OTA_BUCKET"
  exists() { gcloud storage ls "gs://$OTA_BUCKET/$1" >/dev/null 2>&1; }
  fetch() { gcloud storage cat "gs://$OTA_BUCKET/$1"; }
  # Sha-keyed objects never change, so they cache forever. Only latest.json moves.
  put_tree() {
    gcloud storage rsync -r "$1" "gs://$OTA_BUCKET/$2" \
      --cache-control="public, max-age=31536000, immutable"
  }
  put_file() {
    local cache="public, max-age=31536000, immutable"
    [[ "$2" == */latest.json || "$2" == */last-publish.json ]] && cache="no-cache, max-age=0"
    gcloud storage cp "$1" "gs://$OTA_BUCKET/$2" --cache-control="$cache"
  }
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# A new id and time on every publish: devices take the newest, so this is what
# lets a rollback (an older sha) reach devices that already have a later one.
stamp() {
  node -e '
    const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
    m.id = require("crypto").randomUUID();
    m.createdAt = new Date().toISOString();
    process.stdout.write(JSON.stringify(m));
  '
}

go_live() {
  put_file "$1" "$PREFIX/latest.json"
  # What was published last, whatever the runtime version, for the cron in
  # lasagna-infra to compare against main.
  printf '{"commit":"%s","runtimeVersion":"%s","publishedAt":"%s"}\n' \
    "$SHA" "$RUNTIME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STAGE/last-publish.json"
  put_file "$STAGE/last-publish.json" "rn/ios/last-publish.json"
  echo "==> Live for runtime $RUNTIME: $2"
  echo "    Devices download it on their next launch or return to the app, and"
  echo "    switch to it on their next cold start."
  echo "    To roll back, publish an earlier sha. It reuses that build."
}

if [[ "${OTA_ROLLBACK_TO_EMBEDDED:-0}" == "1" ]]; then
  echo '{"directive":"rollBackToEmbedded"}' | stamp > "$STAGE/latest.json"
  go_live "$STAGE/latest.json" "back to each build's own bundle"
  exit 0
fi

# --- Fast path: this sha was published before, so only the pointer moves. ----
if exists "$PREFIX/updates/$SHA/manifest.json"; then
  echo "==> Already built. Repointing only."
  fetch "$PREFIX/updates/$SHA/manifest.json" | stamp > "$STAGE/latest.json"
  go_live "$STAGE/latest.json" "$SHA"
  exit 0
fi

# --- Build -------------------------------------------------------------------
echo "==> Exporting against $VITE_API_URL"
(cd "$APP_DIR" && npx expo export --platform ios --output-dir "$STAGE/dist" >/dev/null)
(cd "$APP_DIR" && npx expo config --type public --json) > "$STAGE/config.json"

# The bucket is world-readable, so a leaked key would be public.
echo "==> Scanning for secrets"
LEAKS=$(grep -rIloE 'sk_(live|test)_|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY' "$STAGE/dist" "$STAGE/config.json" || true)
if [[ -n "$LEAKS" ]]; then
  echo "SECRET-SHAPED STRING FOUND, refusing to publish:" >&2
  echo "$LEAKS" >&2
  exit 1
fi

node "$APP_DIR/scripts/ota-manifest.mjs" "$STAGE/dist" "$BASE_URL/$PREFIX/updates/$SHA" \
  "$RUNTIME" "$SHA" "$STAGE/config.json" > "$STAGE/manifest.json"

# Files first, then the sha's manifest, then the pointer. Never the other way
# round, or the pointer briefly names files that are not there yet.
echo "==> Uploading ($(du -sh "$STAGE/dist" | cut -f1))"
put_tree "$STAGE/dist" "$PREFIX/updates/$SHA"
put_file "$STAGE/manifest.json" "$PREFIX/updates/$SHA/manifest.json"
stamp < "$STAGE/manifest.json" > "$STAGE/latest.json"
go_live "$STAGE/latest.json" "$SHA"
