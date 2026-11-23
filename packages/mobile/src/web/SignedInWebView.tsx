import CookieManager from "@preeternal/react-native-cookie-manager";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentType, type RefAttributes } from "react";
import { StyleSheet, View } from "react-native";
import { WebView as AnyWebView } from "react-native-webview";
import type { IOSWebViewProps, WebViewMessageEvent } from "react-native-webview/lib/WebViewTypes";
import { useAuth } from "@/auth/AuthProvider";
import { getToken } from "@/auth/token";
import { API_URL, WEB_URL } from "@/config";
import { getTheme } from "@lasagna/design";
import { useTheme as useDesign } from "@/design";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { space, themedStyles, useTheme } from "@/theme";
import { CardSkeleton } from "@/ui/Card";
import { Skeleton } from "@/ui/Skeleton";
import { ErrorState } from "@/ui/State";
import { amountsScript, cookieFor, injectedScript } from "./inject";
import { designScript, titleScript } from "./web-theme";

// The package types WebView with every platform's props intersected, which
// collapses to never. This app is iOS only.
type Native = { goBack(): void; reload(): void; injectJavaScript(js: string): void };
const WebView = AnyWebView as unknown as ComponentType<IOSWebViewProps & RefAttributes<Native>>;

// The session cookie goes into the WKWebView store once per token, not once per
// screen. The store's completion can stall, so a screen waits at most a moment.
let cookieSet: { token: string; done: Promise<void> } | null = null;
function sessionCookie(token: string): Promise<void> {
  if (cookieSet?.token !== token) {
    const { url, cookie } = cookieFor(API_URL, token);
    const set = CookieManager.set(url, cookie, true).then(() => undefined, () => undefined);
    cookieSet = { token, done: Promise.race([set, new Promise<void>((r) => setTimeout(r, 1500))]) };
  }
  return cookieSet.done;
}

/** If the page never says it is ready (a page without the app shell), show it anyway after this long. */
const READY_FALLBACK_MS = 4000;

export type NavKind = "push" | "replace" | "pop" | "load";
export type WebViewHandle = { goBack(): void; reload(): void };

/**
 * The hosted web app at `path`, signed in with the native session (the
 * lasagna_session cookie for the API host, and the web app's own last-known
 * user so its first render is already signed in) and following the native
 * hide-amounts setting. The native skeleton covers it until the page posts
 * that it has drawn its content. Pull down reloads the page. Reports every
 * navigation through `onNav`.
 */
type Props = {
  path: string;
  onNav: (path: string, kind: NavKind) => void;
  hideChrome?: boolean;
  /** The page's in-content title (and whether it is a tab's root, the large size). Omitted: no title. */
  title?: { text: string; root: boolean };
  /** The page's vertical scroll, as it changes. */
  onScrollY?: (y: number) => void;
};

export const SignedInWebView = forwardRef<WebViewHandle, Props>(
  function SignedInWebView({ path, onNav, hideChrome = true, title, onScrollY }, ref) {
    const t = useTheme();
    const { user, tenant } = useAuth();
    const hidden = useAmountsHidden();
    // The active design system and scheme, which the page takes on (web-theme.ts).
    const { id: designId, scheme } = useDesign();
    const design = designScript(getTheme(designId), scheme) + (title ? titleScript(title.text, title.root) : "");
    const [cookieReady, setCookieReady] = useState(false);
    const [pageReady, setPageReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const web = useRef<Native>(null);
    const loadedWith = useRef(hidden);
    const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({ goBack: () => web.current?.goBack(), reload: () => web.current?.reload() }), []);

    useEffect(() => {
      let live = true;
      void sessionCookie(getToken() ?? "").then(() => live && setCookieReady(true));
      return () => {
        live = false;
        if (fallback.current) clearTimeout(fallback.current);
      };
    }, []);

    // The web app reads the flag once at boot, so a change made natively
    // (or on another tab) reloads the page with the new value.
    useEffect(() => {
      if (loadedWith.current === hidden) return;
      loadedWith.current = hidden;
      web.current?.injectJavaScript(`${amountsScript(hidden)}location.reload();true;`);
    }, [hidden]);

    // A theme or scheme change restyles the page in place.
    const appliedDesign = useRef(design);
    const appliedId = useRef(designId);
    useEffect(() => {
      if (appliedDesign.current === design) return;
      appliedDesign.current = design;
      // Another theme can rename the assistant in the page's copy, which only a render shows: reload into it.
      const reload = appliedId.current !== designId;
      appliedId.current = designId;
      web.current?.injectJavaScript(`${design}${reload ? "location.reload();" : ""}true;`);
    }, [design, designId]);

    function onMessage(e: WebViewMessageEvent) {
      let msg: { type?: string; path?: string; kind?: NavKind };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === "ready") setPageReady(true);
      else if (msg.type === "nav" && msg.path) onNav(msg.path, msg.kind ?? "push");
      else if (msg.type === "scroll" && typeof (msg as { y?: unknown }).y === "number") onScrollY?.((msg as { y: number }).y);
    }

    if (failed) {
      return (
        <ErrorState
          title="This page didn't load"
          body="Check your connection and try again."
          onRetry={() => {
            setPageReady(false);
            setFailed(false);
          }}
        />
      );
    }
    return (
      <View style={styles.fill}>
        {cookieReady ? (
          <WebView
            ref={web}
            source={{ uri: `${WEB_URL}${path}` }}
            sharedCookiesEnabled
            injectedJavaScriptBeforeContentLoaded={`${design}${injectedScript({ hideChrome, amountsHidden: hidden, authHint: user ? { user, tenant } : null })}`}
            onMessage={onMessage}
            onError={() => setFailed(true)}
            onLoadEnd={() => {
              if (fallback.current) clearTimeout(fallback.current);
              fallback.current = setTimeout(() => setPageReady(true), READY_FALLBACK_MS);
            }}
            onContentProcessDidTerminate={() => web.current?.reload()}
            style={{ backgroundColor: t.canvas }}
            contentInsetAdjustmentBehavior="never"
            allowsBackForwardNavigationGestures={false}
            // The native pull-to-refresh, in place of the web shell's own.
            pullToRefreshEnabled={hideChrome}
          />
        ) : null}
        {/* Only the first load. A reload keeps the page on screen while it refreshes. */}
        {!pageReady ? <PageSkeleton /> : null}
      </View>
    );
  },
);

/** A web page's outline while it loads: a heading and a few cards. */
function PageSkeleton() {
  const t = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.page, { backgroundColor: t.canvas }]} accessibilityLabel="Loading" accessible>
      <Skeleton width="45%" height={26} />
      {[3, 2, 4].map((lines, i) => (
        <CardSkeleton key={i} lines={lines} />
      ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    fill: { flex: 1 },
    page: { padding: space.screen, gap: space.md },
  }),
);
