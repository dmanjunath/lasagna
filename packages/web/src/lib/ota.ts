/**
 * Over-the-air web-bundle updates — Capgo in self-hosted manual mode.
 *
 * The native shell ships a builtin `dist/`. This module asks a static manifest
 * which bundle should be running, downloads it in the background, and queues it
 * with `next()` so it swaps in the next time the app is backgrounded or killed,
 * rather than reloading the page out from under a live session.
 *
 * Only interpreted JS/HTML/CSS moves this way — a bundle that needs a native
 * capability the installed shell lacks is refused via `minNativeVersion`.
 *
 * Nothing here contacts Capgo's cloud: autoUpdate is off and the plugin's three
 * cloud endpoints are blanked in capacitor.config.ts.
 */
import { CapacitorUpdater } from '@capgo/capacitor-updater';

/** Static JSON published by the release pipeline, fetched from VITE_OTA_MANIFEST_URL. */
export interface OtaManifest {
  /** Bundle version, numeric-dotted. Independent of the native app version. */
  version: string;
  /** HTTPS URL of the bundle zip. */
  url: string;
  /** sha256 of the zip. The plugin verifies it before the bundle can be applied. */
  checksum: string;
  /** Lowest native shell version able to run this bundle. */
  minNativeVersion: string;
}

export type OtaDecision =
  | { apply: true; manifest: OtaManifest }
  | { apply: false; reason: 'malformed' | 'up-to-date' | 'native-too-old' };

const MANIFEST_URL: string = import.meta.env.VITE_OTA_MANIFEST_URL || '';

/**
 * Version of the bundle this code came from, baked in at build time. The plugin
 * reports the builtin bundle as "builtin" rather than a version, so the running
 * code has to carry its own version to compare against the manifest.
 */
const BUNDLE_VERSION: string = import.meta.env.VITE_OTA_BUNDLE_VERSION || '';

/**
 * Commit the running bundle was built from, baked in beside its version and for
 * the same reason: the bundle has to carry its own identity, because the plugin
 * knows the builtin one only as "builtin". Blank in any build the release
 * scripts did not produce. The release scripts decide the format, so a build
 * from a dirty tree can say so.
 */
const COMMIT_SHA: string = import.meta.env.VITE_OTA_COMMIT_SHA || '';

/**
 * The store build, the web bundle running on top of it, and the commit that
 * bundle came from. Without the commit, working out which code a device is on
 * means looking its bundle version up in the published manifest.
 *
 * A build carrying no sha shows no parentheses rather than empty ones.
 */
export function buildVersionLabel(
  version: string,
  build: string,
  bundle: string,
  sha: string = COMMIT_SHA,
): string {
  return `Version ${version} (${build}), update ${bundle}${sha ? ` (${sha})` : ''}`;
}

const NUMERIC_VERSION = /^\d+(\.\d+)*$/;

/** Numeric-dotted compare. Missing segments count as zero, so "1.0" equals "1.0.0". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = Number(pa[i] ?? 0) - Number(pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether to apply the manifest's bundle. Pure so the gating rules — which are
 * the part that can white-screen every install at once — are unit-testable.
 */
export function decideUpdate(
  manifest: unknown,
  bundleVersion: string,
  nativeVersion: string,
): OtaDecision {
  const m = manifest as Partial<OtaManifest> | null;
  const wellFormed =
    !!m &&
    typeof m.version === 'string' &&
    NUMERIC_VERSION.test(m.version) &&
    typeof m.url === 'string' &&
    m.url.startsWith('https://') &&
    typeof m.checksum === 'string' &&
    m.checksum.length > 0 &&
    typeof m.minNativeVersion === 'string' &&
    NUMERIC_VERSION.test(m.minNativeVersion);
  if (!wellFormed) return { apply: false, reason: 'malformed' };

  // The shell must be new enough for whatever native APIs the bundle calls.
  if (
    !NUMERIC_VERSION.test(nativeVersion) ||
    compareVersions(nativeVersion, m.minNativeVersion!) < 0
  ) {
    return { apply: false, reason: 'native-too-old' };
  }

  // Whatever the manifest names wins, in either direction. Moving backwards is
  // the point: publishing an earlier bundle is how a bad release is pulled off
  // devices that already applied it.
  //
  // Fail closed when this build carries no version of its own — without one
  // there is no way to tell whether the manifest names something different.
  if (!NUMERIC_VERSION.test(bundleVersion) || compareVersions(m.version!, bundleVersion) === 0) {
    return { apply: false, reason: 'up-to-date' };
  }

  return { apply: true, manifest: m as OtaManifest };
}

/**
 * Tell the native layer this bundle booted. Must run on every launch and before
 * any network call — a bundle that never reports ready is rolled back.
 */
export async function notifyOtaReady(): Promise<void> {
  await CapacitorUpdater.notifyAppReady();
}

/**
 * Version of the web bundle actually running — the builtin one, or whichever
 * OTA bundle replaced it. Shown in Settings so a support conversation can
 * establish what a device is really on, which the store version alone no
 * longer tells you.
 */
export async function runningBundleVersion(): Promise<string> {
  const { bundle } = await CapacitorUpdater.current();
  return bundle.version;
}

/** Fetch the manifest and, if it names a different bundle, download and queue it. */
export async function checkForOtaUpdate(): Promise<void> {
  if (!MANIFEST_URL) return; // OTA not configured for this build

  // A bundle is already queued for the next background — don't stack another.
  // Test for an id, not truthiness: the plugin types this as `BundleInfo | null`
  // but iOS answers `call.resolve()` with no arguments, which the Capacitor
  // bridge delivers as `{}` — truthy, and it would skip every check.
  const pending = await CapacitorUpdater.getNextBundle();
  if (pending?.id) return;

  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ota manifest ${res.status}`);

  const { native } = await CapacitorUpdater.current();
  const decision = decideUpdate(await res.json(), BUNDLE_VERSION, native);
  if (!decision.apply) {
    console.info(`[ota] no update: ${decision.reason}`);
    return;
  }

  const bundle = await CapacitorUpdater.download({
    url: decision.manifest.url,
    version: decision.manifest.version,
    checksum: decision.manifest.checksum,
  });
  // Applies the next time the app is backgrounded or killed, so the running
  // session is never yanked out from under the user. Note the tradeoff: someone
  // who switches away for a few seconds comes back to a reloaded app and loses
  // in-progress UI state. A `setMultiDelay` background condition would avoid
  // that, but it only clears on a *later* foreground, so the bundle would not
  // land until the background after that — too slow for shipping fixes.
  await CapacitorUpdater.next({ id: bundle.id });
  console.info(`[ota] queued ${decision.manifest.version}`);
}
