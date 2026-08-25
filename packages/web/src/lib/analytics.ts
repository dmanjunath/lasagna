/**
 * Umami page analytics, on the hosted deployment only.
 *
 * There is no hosted/self-host flag in this repo: a set env var is the switch,
 * the same way WORKOS_API_KEY turns on WorkOS. With VITE_UMAMI_WEBSITE_ID blank
 * a self-hosted build emits no tag, loads no analytics, and makes no analytics
 * request.
 *
 * Injected from here rather than index.html because Vite leaves an unset
 * `%VITE_X%` in that file as a literal placeholder, which would ship a live
 * tracker carrying a garbage id to every self-hosted build.
 *
 * Three of the tracker settings below are load-bearing, not niceties:
 *
 * - `data-before-send` names a global the tracker awaits before every send,
 *   giving us the payload to rewrite. Ids in the *path* are the reason: umami
 *   reports the whole URL, so /accounts/<uuid> would hand a third party the
 *   identifier of a real account. `beforeSend` replaces those segments.
 * - `data-exclude-search` blanks the query string, and /reset-password?token=…
 *   and /accept-invite?token=… carry single-use credentials there.
 * - `data-exclude-hash` blanks the fragment for the same reason.
 *
 * `data-do-not-track` only makes the tracker read navigator.doNotTrack. It
 * knows nothing about Global Privacy Control, which is a binding opt-out in
 * California, so `optedOut()` gates the tag itself: under either signal no
 * script is loaded and no request is made.
 *
 * Never loaded inside the native shell — tracking has no business in the app.
 */
import { isNativeApp } from './native';

const WEBSITE_ID: string = import.meta.env.VITE_UMAMI_WEBSITE_ID || '';

/**
 * Name of the global the tracker calls before every send. It has to be a bare
 * property of `window`: the tracker resolves the attribute as `window[value]`,
 * so a dotted path would silently never be found.
 */
const BEFORE_SEND = '__lasagnaUmamiBeforeSend';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every real route segment is lowercase words joined by hyphens: `accounts`, `financial-plans`. */
const ROUTE_WORD = /^[a-z]+(?:-[a-z]+)*$/;

/**
 * Shape-based, so a route added later is covered without editing a table here:
 * a UUID, an all-digit segment, or a long segment that isn't shaped like a
 * route word. The longest real segment today is 15 characters, and one that
 * long is still spared when it reads as words.
 */
function isIdSegment(segment: string): boolean {
  if (UUID.test(segment)) return true;
  if (/^[0-9]+$/.test(segment)) return true;
  return segment.length >= 16 && !ROUTE_WORD.test(segment);
}

/**
 * Replace id-looking path segments with `:id`, so /accounts/<uuid> reports as
 * /accounts/:id. Handles both shapes umami sends: `url` is an absolute URL, and
 * `referrer` is a bare path when you came from another page on this site.
 */
export function scrubIds(value: string): string {
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(value)?.[0] ?? '';
  const rest = value.slice(origin.length);
  const cut = rest.search(/[?#]/);
  const path = cut === -1 ? rest : rest.slice(0, cut);
  const tail = cut === -1 ? '' : rest.slice(cut);
  const scrubbed = path
    .split('/')
    .map((segment) => (isIdSegment(segment) ? ':id' : segment))
    .join('/');
  return origin + scrubbed + tail;
}

type UmamiPayload = { url?: unknown; referrer?: unknown };

/** Called by the tracker as `beforeSend(type, payload)`. Whatever it returns is what gets sent. */
export function beforeSend(_type: string, payload: UmamiPayload): UmamiPayload {
  const next = { ...payload };
  if (typeof next.url === 'string') next.url = scrubIds(next.url);
  if (typeof next.referrer === 'string') next.referrer = scrubIds(next.referrer);
  return next;
}

/** True when the browser asks not to be tracked, by either signal. */
function optedOut(): boolean {
  const nav = navigator as Navigator & {
    doNotTrack?: string | null;
    msDoNotTrack?: string | null;
    globalPrivacyControl?: boolean;
  };
  if (nav.globalPrivacyControl === true) return true;
  const dnt =
    nav.doNotTrack ?? (window as { doNotTrack?: string | null }).doNotTrack ?? nav.msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

export function loadAnalytics(): void {
  if (!WEBSITE_ID || isNativeApp() || optedOut()) return;

  (window as unknown as Record<string, unknown>)[BEFORE_SEND] = beforeSend;

  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://cloud.umami.is/script.js';
  script.setAttribute('data-website-id', WEBSITE_ID);
  script.setAttribute('data-before-send', BEFORE_SEND);
  script.setAttribute('data-do-not-track', 'true');
  script.setAttribute('data-exclude-search', 'true');
  script.setAttribute('data-exclude-hash', 'true');
  document.head.appendChild(script);
}
