import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { Fragment, useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppCover } from "@/auth/AppCover";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { loadDesign, ThemeProvider, useTheme as useDesign } from "@/design";
import { RUNTIME_FACES } from "@/design/fonts";
import { loadAppearance } from "@/lib/appearance";
import { loadAmountsHidden } from "@/lib/hide-amounts";
import { hideSplashOnce } from "@/lib/splash";
import { useTheme } from "@/theme";
import { ToastHost } from "@/ui/Toast";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// Set at build time, as VITE_DEMO_MODE is for the web.
const DEMO = process.env.EXPO_PUBLIC_DEMO_MODE === "true";

/**
 * The gates of packages/web/src/App.tsx, in order: signed out sees sign-in;
 * signed in without the agreements sees the consent screen; with onboarding
 * unfinished (and not put off with "Finish later") sees onboarding; everyone
 * else sees the app. The forgot and reset password screens, the invite link
 * and the billing return open in any state.
 */
function RootStack() {
  const { status, user } = useAuth();
  const t = useTheme();
  // A design switch rebuilds the screens from scratch: native views keep
  // measurements and styles from the old theme's faces and sizes otherwise.
  const { id: designId } = useDesign();

  // The first screen hides the launch screen from its own onLayout
  // (hideSplashOnce). This is the backstop if a screen never does.
  useEffect(() => {
    if (status === "loading") return;
    const id = setTimeout(hideSplashOnce, 2000);
    return () => clearTimeout(id);
  }, [status]);

  if (status === "loading") return null;
  const signedIn = status === "signedIn" && !!user;
  const needsConsent = signedIn && user.hasAcceptedTerms === false;
  const needsOnboarding = signedIn && !needsConsent && user.onboardingStage !== null && !user.onboardingDeferred && !DEMO;
  return (
    <Fragment key={designId}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.canvas } }}>
        <Stack.Protected guard={signedIn && !needsConsent && !needsOnboarding}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={needsConsent}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={needsOnboarding}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="accept-invite" />
        <Stack.Screen name="billing/success" />
      </Stack>
      <AppCover signedIn={signedIn} />
    </Fragment>
  );
}

// Read once at boot: the saved design system and light or dark. The launch screen stays up until they and the fonts are in.
const designLoaded = Promise.all([loadDesign(), loadAppearance()]);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(RUNTIME_FACES);
  const [designReady, setDesignReady] = useState(false);
  useEffect(() => {
    loadAmountsHidden();
    void designLoaded.then(() => setDesignReady(true));
  }, []);
  // A font that fails to load falls back to the system face rather than holding the app.
  if (!designReady || (!fontsLoaded && !fontError)) return null;
  return (
    <ThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootStack />
            <ToastHost />
          </AuthProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
