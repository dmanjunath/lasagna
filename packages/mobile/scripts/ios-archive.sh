#!/usr/bin/env bash
# Builds a signed, App Store-ready .ipa of the React Native app. Signing and
# hostnames come from lasagna-infra (this public repo carries none):
#   ../lasagna-infra/ios/signing.env  ->  IOS_TEAM_ID, VITE_API_URL, MOBILE_WEB_URL
# MOBILE_WEB_URL is the hosted web app the fallback screens load.
# Usage: pnpm -F @lasagna/mobile ios:archive
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INFRA_ENV="${LASAGNA_IOS_SIGNING_ENV:-$APP_DIR/../../../lasagna-infra/ios/signing.env}"
if [[ -f "$INFRA_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$INFRA_ENV"
fi
: "${IOS_TEAM_ID:?IOS_TEAM_ID not set. Create lasagna-infra/ios/signing.env (see signing.env.example)}"
: "${VITE_API_URL:?VITE_API_URL not set. It is the API origin, not the web app}"
: "${MOBILE_WEB_URL:?MOBILE_WEB_URL not set. Add the hosted web app origin to signing.env}"

# The app config's env, shared with ota-publish.sh so both compute the same
# runtime version.
# shellcheck disable=SC1091
source "$APP_DIR/scripts/ota-env.sh"
if [[ -z "${EXPO_UPDATES_URL:-}" ]]; then
  echo "WARNING: no OTA code-signing certificate, so this build cannot take over-the-air updates." >&2
fi
# Build numbers must only go up, and must clear the Capacitor builds that
# shipped under the same bundle ID. A timestamp does both.
export IOS_BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"

BUILD_DIR="$APP_DIR/build"
ARCHIVE="$BUILD_DIR/LasagnaFi.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
mkdir -p "$BUILD_DIR"

echo "==> Generating the iOS project (build $IOS_BUILD_NUMBER, API $EXPO_PUBLIC_API_URL)"
# The runtime version this build embeds. A published update reaches it only
# when ota-publish.sh prints the same value.
RUNTIME_VERSION=$(cd "$APP_DIR" && npx expo-updates runtimeversion:resolve --platform ios | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).runtimeVersion')
echo "    Runtime version $RUNTIME_VERSION"
printf '%s\n' "$RUNTIME_VERSION" > "$BUILD_DIR/runtime-version.txt"
# Xcode's build step computes the fingerprint again, and there the app config
# came out different (its auto-detected platforms left out web), so builds
# embedded a runtime version nothing was ever published for. Hand it this one.
export EXPO_UPDATES_FINGERPRINT_OVERRIDE="$RUNTIME_VERSION"
(cd "$APP_DIR" && npx expo prebuild --platform ios --clean)

# Xcode's "[RNDeps] Replace React Native Dependencies" phase swaps the Debug
# prebuilt for the Release one with a recursive delete that fails (ENOTEMPTY)
# when macOS drops a .DS_Store into the folder mid-delete. Do the swap here,
# retrying, so the phase finds Release already in place and skips it.
PODS_ROOT="$APP_DIR/ios/Pods"
RN_DIR="$(cd "$APP_DIR" && node -p 'require("path").dirname(require.resolve("react-native/package.json"))')"
RN_VERSION="$(node -p "require('$RN_DIR/package.json').version")"
DEPS="$PODS_ROOT/ReactNativeDependencies"
TARBALL="$PODS_ROOT/ReactNativeDependencies-artifacts/reactnative-dependencies-$RN_VERSION-release.tar.gz"
# rm -rf that tolerates a .DS_Store appearing mid-delete.
rm_tree() {
  for _ in 1 2 3 4 5; do
    rm -rf "$1" 2>/dev/null && [[ ! -e "$1" ]] && return 0
    find "$1" -name .DS_Store -delete 2>/dev/null || true
    sleep 0.5
  done
  [[ ! -e "$1" ]]
}
rm_tree "$DEPS/framework"
mkdir -p "$DEPS/framework"
tar -xf "$TARBALL" -C "$DEPS/framework"
mv "$DEPS/framework/packages/react-native/third-party/ReactNativeDependencies.xcframework" \
  "$DEPS/framework/packages/react-native/ReactNativeDependencies.xcframework"
rm_tree "$DEPS/framework/packages/react-native/third-party"
printf Release > "$DEPS/.last_build_configuration"

echo "==> Archiving"
xcodebuild -workspace "$APP_DIR/ios/LasagnaFi.xcworkspace" -scheme LasagnaFi -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" archive \
  DEVELOPMENT_TEAM="$IOS_TEAM_ID" -allowProvisioningUpdates

EMBEDDED=$(cat "$ARCHIVE/Products/Applications/LasagnaFi.app/EXUpdates.bundle/fingerprint")
if [[ "$EMBEDDED" != "$RUNTIME_VERSION" ]]; then
  echo "ERROR: the build embeds runtime version $EMBEDDED, not $RUNTIME_VERSION. It would never get an update." >&2
  exit 1
fi

cat > "$BUILD_DIR/exportOptions.plist" <<PLIST
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
PLIST

echo "==> Exporting .ipa"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$BUILD_DIR/exportOptions.plist" \
  -exportPath "$EXPORT_DIR" -allowProvisioningUpdates

echo "==> Done: $EXPORT_DIR/LasagnaFi.ipa (runtime version $RUNTIME_VERSION)"
echo "Upload via Xcode Organizer or the Transporter app."
