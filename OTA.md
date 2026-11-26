# Over-the-air updates

The React Native app (`packages/mobile`) takes JavaScript and asset changes
without an App Store submission: Expo Updates, served by our own API,
published by the `Publish OTA bundle` workflow in `lasagna-infra`, keyed by
commit sha, and rolled back by publishing an earlier sha. Real values (bucket,
hosts, keys) live in `lasagna-infra`, never in this repo.

The old Capacitor shell (`packages/web/ios`) is **deprecated**. Nothing
publishes its web bundle any more, and installs move to the React Native app,
which ships under the same bundle ID, through the App Store. Its section is
kept below for reference only.

## The React Native app

### What can and cannot ship this way

| Ships over the air | Needs an App Store build |
| --- | --- |
| Anything in `packages/mobile/app` and `src` | A new or upgraded native module |
| Images, fonts and other assets | A config plugin, `app.config.ts` native settings |
| Copy, layout, client-side fixes | New permissions, Info.plist, the app icon |

No gate is needed to enforce this. Every update is stored under the **runtime
version**, a fingerprint of the native code and the app config
(`runtimeVersion: { policy: "fingerprint" }`). A build only asks for updates
with its own runtime version, so an update that needs different native code
never reaches it. A native change simply starts a new runtime version, which
gets updates once a build with it ships.

### How it works

1. On launch, expo-updates asks `GET <API>/updates/manifest` with its runtime
   version. The app opens on what it already has, without waiting.
2. The API (`packages/api/src/routes/updates.ts`) reads the live pointer for
   that runtime version from the bucket (`rn/ios/<runtime>/latest.json`) and
   answers with the manifest, "no update" when the device already has it, or a
   roll-back directive. It signs what it sends.
3. The app downloads the bundle and assets straight from the bucket, checks
   each file's hash and the signature, and keeps the update.
4. It switches to it on the next cold start. It also checks again on each
   return to the foreground (`src/lib/ota.ts`), so a long session still
   downloads it. Unlike the Capacitor shell it does not switch while in the
   background: reloading a backgrounded React Native app left a blank screen.

The app only accepts updates signed by our key. Its certificate is embedded at
build time, and the private key is only in Secret Manager
(`OTA_CODE_SIGNING_KEY`), so a person with bucket access alone cannot push code.

### Publishing

`Publish OTA bundle` runs `packages/mobile/scripts/ota-publish.sh`, on the
6-hour cron and on dispatch. The cron publishes when `main` differs from the
commit in `rn/ios/last-publish.json`, which every publish writes. It needs the commit's
`Tests` run green (`force` bypasses). Locally:
`pnpm -F @lasagna/mobile ota:publish [<sha>]`.

The script prints the runtime version it publishes for, and
`ios-archive.sh` prints the one each build embeds. **An update reaches a build
only when the two match.** Both scripts take the app config's env from
`scripts/ota-env.sh`, so they compute it the same way. Change that env there,
never in one script alone.

### Rolling back

- **A bad update**: dispatch `Publish OTA bundle` with the last good sha. It is
  reused, so it lands in seconds, and it is stamped as the newest update so
  devices take it. Publishing a sha that is not `main`
  disables the cron until you publish `main` again.
- **Back to what each build shipped with**: dispatch with
  `rollback_to_embedded`. Devices drop every update and run their own bundle.
- **A bundle that crashes on launch** is reverted by expo-updates on the
  device, which falls back to the previous update.
- **A bad native change** needs an App Store build, as before.

### Setup in lasagna-infra

- `ios/ota/` (local only, never committed anywhere public): the code-signing
  `certificate.pem` and `private-key.pem`. Losing the private key means
  installed builds can take no more updates until a new build ships.
- GitHub variables: `MOBILE_WEB_URL`, and `OTA_CODE_SIGNING_CERT` (the public
  certificate's contents). `OTA_BUCKET` and `VITE_API_URL` too.
- Secret Manager (wired into the API on deploy): `OTA_BASE_URL` (the bucket's
  public URL) and `OTA_CODE_SIGNING_KEY`.

## The Capacitor shell (deprecated, no longer published)

Everything below describes the retired system. Its publish job and script
(`packages/web/scripts/ota-publish.sh`) are gone. The live web bundle stays
where it was, so installed shells keep running it.

### What can and cannot ship this way

| Ships over the air | Needs an App Store build |
| --- | --- |
| React and UI changes | New or upgraded Capacitor plugin |
| Styling, copy, layout | Native Swift |
| Client-side bug fixes | New permissions |
| Anything else inside `dist/` | App icon, launch screen |

The publish script enforces this: it refuses to publish across a change to the
plugin list, `Info.plist`, or any `.swift` file. That gate matters because such
a bundle **boots normally** and only fails when the missing plugin is called, so
the in-app auto-rollback cannot catch it.

### How it works

The app ships a complete builtin `dist/`. On launch and on resume it fetches a
static `latest.json`. If the version differs from the one baked into the running
bundle, and the installed shell satisfies `minNativeVersion`, it downloads the
zip, verifies the sha256 natively, and queues it with `next()`. The swap happens
the next time the app is backgrounded or killed, so a live session is never
interrupted.

The builtin copy always stays on disk and is the rollback target. Steady state
is builtin plus one OTA bundle.

The version rule is **different**, not **newer**. Publishing an earlier bundle
is how a bad release is pulled off devices that already applied it.

### Publishing

Everything goes through one GitHub Action in `lasagna-infra`, which is the only
thing that writes to the bucket. Nothing is edited by hand.

- **Automatic**: a cron checks every 6 hours and publishes when `main` differs
  from the commit recorded in the live manifest.
- **Manual**: dispatch `Publish OTA bundle`. Leave the sha blank for current
  `main`, or give a sha to publish that commit.

Two gates, both bypassable with `force` on a manual dispatch:

1. The commit's `Tests` run must have concluded `success`.
2. The native surface must be unchanged versus the live commit.

Bundles are keyed by commit sha, so a sha identifies its own contents. The
script refuses to run against a dirty working tree for the same reason, and
refuses to upload a bundle containing a secret-shaped string or a source map.

Locally: `pnpm -F @lasagna/web ota:publish [<sha>]`.

### Rolling back

Three different things get called rollback. They are not interchangeable.

**A bundle that fails to boot** is handled automatically, per device. If it does
not call `notifyAppReady()` within 10 seconds the native layer reverts to the
last bundle that booted. You do not need to do anything, though you should still
stop serving it. This only catches total boot failure.

**A bundle that boots but misbehaves** is invisible to that safety net. Dispatch
`Publish OTA bundle` with the last good sha. If that sha was already built the
bundle is reused and only the manifest moves, so it lands in seconds.

Publishing a sha that is not current `main` also **disables the cron**, so the
rollback holds instead of being undone at the next tick. While it is disabled,
**no commit is shipping**. The workflow shows as disabled in the Actions list;
nothing else will remind you. Publishing current `main` re-enables it.

**A bad native change cannot be rolled back over the air at all.** It needs an
App Store submission. This is what the native-compat gate exists to prevent.

Note that rolling back to a commit from before OTA existed would leave the app
with no updater, so it could only be recovered through the App Store. The native
gate blocks that too.

### Checking what a device is running

Settings shows the store build, the bundle running on top of it, and the commit
that bundle was built from:

    Version 1.0 (14), update 1.0.1787765995 (45736ba)
    Version 1.0 (14), update builtin (45736ba)

The store version alone no longer identifies what is running, since the web
layer moves independently, and the bundle version is only the marketing version
plus a build timestamp. A builtin bundle carries the marketing version alone,
and the plugin reports it as `builtin`. The sha names the code directly, so a
screenshot of that line answers the question without bucket access.

The release scripts bake the sha in as `VITE_OTA_COMMIT_SHA` and own its format.
`ios-archive.sh`, unlike the publish script, does not refuse a dirty tree, so a
dirty build reads `45736ba-dirty` rather than naming a commit it is not. It
judges dirty with `git diff --quiet HEAD`, which ignores untracked files, so a
tree dirty only with new untracked files still gets a clean sha. The publish
script's `git status --porcelain` counts those files and refuses. A build with
no sha set shows no parentheses rather than empty ones.

### Apple compliance

Apple's guidelines allow an app to download and execute interpreted code,
provided it does not change the app's primary purpose and the code is run by the
system's built-in interpreters (here, JavaScriptCore inside `WKWebView`).

This implementation stays inside that allowance:

- Only JavaScript, HTML, and CSS ship over the air. No native code, ever.
- The app's purpose and feature set are unchanged by an update.
- No new permissions or native capabilities can be introduced, enforced by the
  native-compat gate rather than left to discipline.

### Security

The bundle is world-readable by design, so it must never contain a secret. Vite
bakes `VITE_*` values into `dist`, and only public ones are used (the API URL
and the OTA manifest URL). The publish script fails the build rather than
uploading anything that looks like a key.

The bucket has uniform bucket-level access, public object **read** only, no
listing, and object versioning on. Anonymous write and delete are denied.
Publishing runs as a service account, not a user credential.

Every bundle's sha256 is recorded in the manifest and verified natively before
the bundle can be applied.

### Gotchas worth knowing

- `getNextBundle()` is typed `BundleInfo | null`, but iOS resolves it with no
  arguments, which the Capacitor bridge delivers as `{}`. Test for an id, not
  truthiness, or the update check silently never runs.
- The manifest fetch needs CORS on the bucket. The WebView origin is
  `capacitor://localhost`, so without it the request returns 200 and the
  JavaScript still cannot read the body. The zip download is native and is not
  subject to CORS.
- Every build must bake `VITE_OTA_BUNDLE_VERSION`. The plugin reports the
  builtin bundle as `"builtin"` rather than a version, so the running code has
  to carry its own. It fails closed if the variable is missing.
- After a rollback, the manifest still names the bad bundle until you publish,
  so devices that auto-rolled-back will keep re-downloading it. They stay on
  working code throughout; it is wasted bandwidth, not breakage.
