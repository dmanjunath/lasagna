#!/usr/bin/env bash
# Builds a signed, App Store-ready .ipa. Signing identity comes from
# lasagna-infra (this public repo carries no team IDs):
#   ../lasagna-infra/ios/signing.env  →  IOS_TEAM_ID, VITE_API_URL
# VITE_UMAMI_WEBSITE_ID is optional there; blank ships a builtin bundle that
# counts no page views.
# Usage: pnpm -F @lasagna/web ios:archive
set -euo pipefail

WEB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INFRA_ENV="${LASAGNA_IOS_SIGNING_ENV:-$WEB_DIR/../../../lasagna-infra/ios/signing.env}"
if [[ -f "$INFRA_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$INFRA_ENV"
fi
: "${IOS_TEAM_ID:?IOS_TEAM_ID not set — create lasagna-infra/ios/signing.env (see signing.env.example)}"
: "${VITE_API_URL:?VITE_API_URL not set — e.g. https://app.lasagnafi.com}"
: "${VITE_OTA_MANIFEST_URL:?VITE_OTA_MANIFEST_URL not set — without it the shipped app cannot take OTA updates}"

# Blank is valid, not fatal, matching ota-publish.sh: it is what a self-hosted
# build gets, and it fails toward counting nothing. Warned about below so a
# variable someone forgot to set is visible rather than silent.
UMAMI_ID="${VITE_UMAMI_WEBSITE_ID:-}"

# The builtin bundle needs its own version to compare against the OTA manifest;
# the updater plugin reports it only as "builtin". Defaults to the app's
# marketing version, so a store build at 1.1 ships bundle 1.1 and OTA releases
# continue 1.1.1, 1.1.2, …
MARKETING_VERSION=$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);.*/\1/p' \
  "$WEB_DIR/ios/App/App.xcodeproj/project.pbxproj" | head -1)
VITE_OTA_BUNDLE_VERSION="${OTA_BUNDLE_VERSION:-$MARKETING_VERSION}"
: "${VITE_OTA_BUNDLE_VERSION:?could not determine bundle version — set OTA_BUNDLE_VERSION}"

BUILD_DIR="$WEB_DIR/ios/build"
ARCHIVE="$BUILD_DIR/App.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
mkdir -p "$BUILD_DIR"

echo "==> Building web bundle $VITE_OTA_BUNDLE_VERSION against $VITE_API_URL"
if [[ -z "$UMAMI_ID" ]]; then
  echo "    VITE_UMAMI_WEBSITE_ID is blank, so the builtin bundle counts no page views"
fi
(cd "$WEB_DIR" && VITE_API_URL="$VITE_API_URL" \
  VITE_OTA_MANIFEST_URL="$VITE_OTA_MANIFEST_URL" \
  VITE_OTA_BUNDLE_VERSION="$VITE_OTA_BUNDLE_VERSION" \
  VITE_UMAMI_WEBSITE_ID="$UMAMI_ID" \
  pnpm build && npx cap sync ios)

echo "==> Archiving"
xcodebuild -project "$WEB_DIR/ios/App/App.xcodeproj" -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" archive \
  DEVELOPMENT_TEAM="$IOS_TEAM_ID" -allowProvisioningUpdates

cat > "$BUILD_DIR/exportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>${IOS_TEAM_ID}</string>
</dict>
</plist>
EOF

echo "==> Exporting .ipa"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$BUILD_DIR/exportOptions.plist" \
  -exportPath "$EXPORT_DIR" -allowProvisioningUpdates

echo "==> Done: $EXPORT_DIR/App.ipa"
echo "Upload via Xcode Organizer or the Transporter app."
