#!/usr/bin/env bash
# Publishes a web bundle over-the-air, keyed by commit SHA. This is the only
# thing that writes to the OTA bucket — nothing is edited by hand.
#
# Publishing an EARLIER sha is how a rollback works: the app applies whatever
# the manifest names, in either direction. If that sha was already built the
# bundle is reused and only the manifest moves, so it lands in seconds.
#
# Only JS/HTML/CSS ships this way. A new Capacitor plugin, native Swift, or a
# new permission needs an App Store build, so this refuses to publish across
# such a change unless OTA_FORCE=1.
#
# Config comes from the environment (lasagna-infra/ios/signing.env locally, or
# GitHub secrets in CI) — this repo is public and carries no real values:
#   OTA_BUCKET, VITE_API_URL, VITE_OTA_MANIFEST_URL, OTA_MIN_NATIVE_VERSION
#   VITE_UMAMI_WEBSITE_ID (optional; blank publishes a bundle with no analytics)
# Usage: pnpm -F @lasagna/web ota:publish [<sha>]     (defaults to HEAD)
set -euo pipefail

WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$WEB_DIR/../.." && pwd)"
INFRA_ENV="${LASAGNA_IOS_SIGNING_ENV:-$REPO_DIR/../lasagna-infra/ios/signing.env}"
if [[ -f "$INFRA_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$INFRA_ENV"
fi
: "${OTA_BUCKET:?OTA_BUCKET not set}"
: "${VITE_API_URL:?VITE_API_URL not set}"
: "${VITE_OTA_MANIFEST_URL:?VITE_OTA_MANIFEST_URL not set}"
# Blank is a valid configuration, not an error: the bundle then loads no
# analytics at all, which is what a self-hosted publish gets. Warned about
# below rather than enforced, so a variable someone forgot to set shows up in
# the log instead of quietly shipping a bundle that counts nothing.
UMAMI_ID="${VITE_UMAMI_WEBSITE_ID:-}"
MIN_NATIVE="${OTA_MIN_NATIVE_VERSION:-1.0}"
FORCE="${OTA_FORCE:-0}"

SHA=$(git -C "$REPO_DIR" rev-parse "${1:-HEAD}")
BUCKET="gs://$OTA_BUCKET"
echo "==> Target $SHA"

# The build comes from the working tree but is stored under a commit sha. If the
# tree is dirty those disagree, and the sha stops identifying its own contents —
# which is exactly what the fast path and every rollback rely on.
if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" && "${OTA_ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "REFUSING: working tree is dirty, so the bundle would not match $SHA." >&2
  echo "Commit first, or set OTA_ALLOW_DIRTY=1 for a throwaway local test." >&2
  exit 1
fi

exists() { gcloud storage ls "$1" >/dev/null 2>&1; }
# sha256sum on Linux, shasum on macOS.
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# --- Fast path: this sha was published before, so only the manifest moves. ----
if exists "$BUCKET/bundles/$SHA.json"; then
  echo "==> Already built. Repointing the manifest only."
  gcloud storage cp "$BUCKET/bundles/$SHA.json" "$BUCKET/latest.json" \
    --cache-control="public, max-age=60"
  gcloud storage cat "$BUCKET/latest.json"
  echo "==> Live: $SHA"
  exit 0
fi

# --- What is live now, so we can diff against it. ----------------------------
LIVE_SHA=$(gcloud storage cat "$BUCKET/latest.json" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("commit",""))' 2>/dev/null || true)

# --- Native-compat gate ------------------------------------------------------
# A bundle that needs a newer shell BOOTS FINE and only fails when the missing
# plugin is called, so the in-app auto-rollback cannot catch it. That is why
# this is a hard stop rather than a warning.
if [[ -n "$LIVE_SHA" ]] && git -C "$REPO_DIR" cat-file -e "$LIVE_SHA^{commit}" 2>/dev/null; then
  native_surface() {
    git -C "$REPO_DIR" show "$1:packages/web/package.json" 2>/dev/null | grep -i capacitor | sort
    git -C "$REPO_DIR" ls-tree -r "$1" -- \
      packages/web/ios/App/CapApp-SPM/Package.swift \
      packages/web/ios/App/App/Info.plist 2>/dev/null
    git -C "$REPO_DIR" ls-tree -r "$1" -- '*.swift' 2>/dev/null
  }
  if ! diff -q <(native_surface "$LIVE_SHA") <(native_surface "$SHA") >/dev/null; then
    echo "REFUSING: the native surface changed between $LIVE_SHA and $SHA." >&2
    diff <(native_surface "$LIVE_SHA") <(native_surface "$SHA") | head -20 >&2
    echo "Plugins, native Swift and permissions cannot ship over the air." >&2
    echo "Ship an App Store build, bump OTA_MIN_NATIVE_VERSION, then publish." >&2
    echo "Set OTA_FORCE=1 only if you are certain this bundle runs on installed shells." >&2
    [[ "$FORCE" == "1" ]] || exit 1
    echo "OTA_FORCE=1 — continuing anyway." >&2
  fi
elif [[ -z "$LIVE_SHA" ]]; then
  echo "==> No live sha recorded, so there is nothing to diff against. Gate skipped."
else
  echo "==> WARNING: $LIVE_SHA is not in this checkout, so the native gate could not run." >&2
fi

# --- Build -------------------------------------------------------------------
MARKETING_VERSION=$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);.*/\1/p' \
  "$WEB_DIR/ios/App/App.xcodeproj/project.pbxproj" | head -1)
# Unique and increasing without needing stored state. The sha is the real key;
# this only has to differ from whatever a device is currently running.
VERSION="${MARKETING_VERSION:-1.0}.$(date +%s)"

echo "==> Building $VERSION from $SHA against $VITE_API_URL"
if [[ -z "$UMAMI_ID" ]]; then
  echo "    VITE_UMAMI_WEBSITE_ID is blank, so this bundle counts no page views"
fi
(
  cd "$WEB_DIR"
  VITE_API_URL="$VITE_API_URL" \
  VITE_OTA_MANIFEST_URL="$VITE_OTA_MANIFEST_URL" \
  VITE_OTA_BUNDLE_VERSION="$VERSION" \
  VITE_OTA_COMMIT_SHA="${SHA:0:7}" \
  VITE_UMAMI_WEBSITE_ID="$UMAMI_ID" \
  pnpm build
)

# The bundle is served world-readable, so a leaked key would be public.
echo "==> Scanning for secrets"
LEAKS=$(grep -rIloE 'sk_(live|test)_|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi' "$WEB_DIR/dist" || true)
if [[ -n "$LEAKS" ]]; then
  echo "SECRET-SHAPED STRING FOUND — refusing to publish:" >&2
  echo "$LEAKS" >&2
  exit 1
fi
if find "$WEB_DIR/dist" -name '*.map' | grep -q .; then
  echo "source maps present in dist — refusing to publish" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
ZIP="$STAGE/$SHA.zip"
(cd "$WEB_DIR/dist" && zip -qr "$ZIP" .)
CHECKSUM=$(sha256 "$ZIP")
echo "==> $VERSION  sha256=$CHECKSUM  ($(du -h "$ZIP" | cut -f1))"

cat > "$STAGE/manifest.json" <<EOF
{
  "version": "$VERSION",
  "url": "https://storage.googleapis.com/$OTA_BUCKET/bundles/$SHA.zip",
  "checksum": "$CHECKSUM",
  "minNativeVersion": "$MIN_NATIVE",
  "commit": "$SHA"
}
EOF

# Bundle first, manifest second — never the other way round, or the manifest
# briefly names an object that is not there yet. Both sha-keyed objects are
# immutable, so they cache forever; only the manifest moves.
echo "==> Uploading bundle"
gcloud storage cp "$ZIP" "$BUCKET/bundles/$SHA.zip" \
  --cache-control="public, max-age=31536000, immutable"
gcloud storage cp "$STAGE/manifest.json" "$BUCKET/bundles/$SHA.json" \
  --cache-control="public, max-age=31536000, immutable"

echo "==> Bumping manifest"
gcloud storage cp "$STAGE/manifest.json" "$BUCKET/latest.json" \
  --cache-control="public, max-age=60"

echo "==> Live: $SHA ($VERSION, min native $MIN_NATIVE)"
echo "    Devices pick it up on their next launch or resume and swap in the"
echo "    next time the app is backgrounded."
echo "    To roll back, publish an earlier sha — it reuses that build."
