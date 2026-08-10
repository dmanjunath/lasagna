#!/usr/bin/env bash
# Builds a signed, App Store-ready .ipa. Signing identity comes from
# lasagna-infra (this public repo carries no team IDs):
#   ../lasagna-infra/ios/signing.env  →  IOS_TEAM_ID, VITE_API_URL
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

BUILD_DIR="$WEB_DIR/ios/build"
ARCHIVE="$BUILD_DIR/App.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
mkdir -p "$BUILD_DIR"

echo "==> Building web bundle against $VITE_API_URL"
(cd "$WEB_DIR" && VITE_API_URL="$VITE_API_URL" pnpm build && npx cap sync ios)

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
