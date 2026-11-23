import { useRef } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/auth/AuthProvider";
import { setPendingPath } from "@/lib/navigation";
import { hideSplashOnce } from "@/lib/splash";
import { splitPath } from "@/lib/routes";
import { useTheme } from "@/theme";
import { SignedInWebView, type NavKind } from "@/web/SignedInWebView";

/**
 * The onboarding gate. Onboarding itself is the web app's, full screen with
 * its own header. When it leaves for the app (home after "Finish later" or
 * finishing, or accounts to connect a bank), native takes over: /auth/me is
 * read again and the gate opens onto that destination.
 */
export default function Onboarding() {
  const t = useTheme();
  const { refresh } = useAuth();
  const leaving = useRef(false);

  const onNav = (path: string, kind: NavKind) => {
    if (kind === "load" || leaving.current) return;
    const { pathname } = splitPath(path);
    if (pathname !== "/" && pathname !== "/accounts") return;
    leaving.current = true;
    if (pathname === "/accounts") setPendingPath(path);
    void refresh().finally(() => {
      leaving.current = false;
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }} edges={["top", "bottom"]} onLayout={hideSplashOnce}>
      <SignedInWebView path="/onboarding" onNav={onNav} hideChrome={false} />
    </SafeAreaView>
  );
}
