#!/usr/bin/env bash
# Sourced by ios-archive.sh and ota-publish.sh. The app config reads this env,
# and the runtime version is a fingerprint of that config, so the two scripts
# MUST set it identically: if they differ, a published update never reaches
# the build it was meant for. Change it here, never in one script alone.
#
# Needs (from lasagna-infra/ios/signing.env locally, GitHub variables in CI):
#   VITE_API_URL               the API origin; the updates endpoint lives on it
#   MOBILE_WEB_URL             the hosted web app the fallback screens load
#   OTA_CODE_SIGNING_CERT_FILE the public code-signing certificate (optional
#                              for a build: without it the build has no OTA)
#   FIREBASE_IOS_PLIST_FILE    GoogleService-Info.plist for push (optional:
#                              without it the build has no push)
# shellcheck disable=SC2034
OTA_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"

export EXPO_PUBLIC_API_URL="$VITE_API_URL"
export EXPO_PUBLIC_WEB_URL="$MOBILE_WEB_URL"

# Push. Its presence changes the app config, so it changes the runtime version
# too: builds and publishes must agree on it like everything else here.
PLIST_SRC="${FIREBASE_IOS_PLIST_FILE:-$OTA_APP_DIR/../../../lasagna-infra/ios/GoogleService-Info.plist}"
if [[ -f "$PLIST_SRC" ]]; then
  mkdir -p "$OTA_APP_DIR/build"
  cp "$PLIST_SRC" "$OTA_APP_DIR/build/GoogleService-Info.plist"
else
  rm -f "$OTA_APP_DIR/build/GoogleService-Info.plist"
fi

CERT_SRC="${OTA_CODE_SIGNING_CERT_FILE:-$OTA_APP_DIR/../../../lasagna-infra/ios/ota/certificate.pem}"
if [[ -f "$CERT_SRC" ]]; then
  # The config names this fixed path, so the fingerprint never depends on
  # where the certificate came from.
  mkdir -p "$OTA_APP_DIR/build"
  cp "$CERT_SRC" "$OTA_APP_DIR/build/ota-certificate.pem"
  export EXPO_UPDATES_URL="${VITE_API_URL%/}/updates/manifest"
else
  unset EXPO_UPDATES_URL
fi
