import { useFocusEffect } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSharedValue } from "react-native-reanimated";
import { View } from "react-native";
import { titleForPath as pageTitle } from "@web/lib/page-titles";
import { openPath } from "@/lib/navigation";
import { splitPath, webNavAction, webSectionTitle } from "@/lib/routes";
import { webDataVersion } from "@/lib/web-stale";
import { useTheme as useDesign } from "@/design";
import { useTheme } from "@/theme";
import { useCollapsingHeader } from "@/ui/ScreenScroll";
import { SignedInWebView, type NavKind, type WebViewHandle } from "./SignedInWebView";
import { TITLE_PAD_TOP } from "./web-theme";

/**
 * An unported screen: the hosted web app inside a native stack screen. On a
 * tab's root it carries the menu button, and a link to another page pushes a
 * native screen in the tab (the web page itself has no back button here).
 * Navigating to a ported route or a tab root hands off to native.
 */
export function WebScreen({ startPath, root = false }: { startPath: string; root?: boolean }) {
  const t = useTheme();
  const own = splitPath(startPath).pathname;
  const d = useDesign();
  // The path's page title, or the section its hash names (Settings' Transaction rules).
  const titleFor = (path: string) => webSectionTitle(path) ?? pageTitle(splitPath(path).pathname) ?? "";
  const [title, setTitle] = useState(() => titleFor(startPath));
  const web = useRef<WebViewHandle>(null);
  // The data the page loaded with. A native change since then reloads it on return (M-1).
  const loadedAt = useRef(webDataVersion());
  useFocusEffect(
    useCallback(() => {
      if (loadedAt.current === webDataVersion()) return;
      loadedAt.current = webDataVersion();
      web.current?.reload();
    }, []),
  );

  function onNav(path: string, kind: NavKind) {
    const next = webNavAction(path, kind, { own, root });
    if (next.action === "stay") {
      // The page's own path keeps the title it opened with (a section's, which its later reports drop).
      if (splitPath(path).pathname !== own) setTitle(titleFor(path));
      return;
    }
    // Undo the web page's own step so this screen stays on its page, then go natively
    // (a chat request switches to the chat tab, which starts it once by its stamp).
    if (kind === "push") web.current?.goBack();
    openPath(path, next.mode);
  }

  // The native bar (a tab root's large title too) is translucent and the
  // screen runs under it, but the web page scrolls its own container and
  // cannot inset itself: so the page starts where the bar ends, measured.
  const headerHeight = useHeaderHeight();
  // The web page reports its scroll. The title it draws sits at the top of its content (web-theme.ts titleCss).
  const scrolled = useSharedValue(0);
  const chrome = useCollapsingHeader({ title: title, root, scrolled });
  const titleType = root ? d.type.largeTitle : d.type.title1;
  const { setTitleFrame } = chrome;
  useEffect(() => setTitleFrame(TITLE_PAD_TOP, Number(titleType.lineHeight ?? 0)), [setTitleFrame, titleType.lineHeight]);
  const box = useRef<React.ComponentRef<typeof View>>(null);
  const [top, setTop] = useState<number | null>(null);
  const inset = top == null ? 0 : Math.max(0, headerHeight - top);

  return (
    <View
      ref={box}
      onLayout={() => box.current?.measureInWindow((_x: number, y: number) => setTop((v) => (v != null && Math.abs(v - y) < 0.5 ? v : y)))}
      style={{ flex: 1, backgroundColor: t.canvas, paddingTop: inset }}
    >
      {/* The page chrome contract, as on a native screen: the title first in the page's content, the slim bar fading its own in as that scrolls away, and the hamburger on a tab's root. */}
      {chrome.bar}
      <SignedInWebView ref={web} path={startPath} onNav={onNav} title={{ text: title, root }} onScrollY={(y) => (scrolled.value = y)} />
    </View>
  );
}
