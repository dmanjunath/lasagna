import { useState } from "react";
import { authApi } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { allConsented, AuthLayout, Banner, ConsentCheckboxes, errorText, NO_CONSENT, TextLink } from "@/components/auth/AuthKit";
import { Button } from "@/ui/Button";

/** The consent gate (packages/web/src/pages/welcome-consent.tsx): signed in, agreements not yet accepted. */
export default function WelcomeConsent() {
  const { refresh, signOut } = useAuth();
  const [consents, setConsents] = useState(NO_CONSENT);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      await authApi.acceptTerms();
      // /auth/me now says accepted, and the gate opens.
      await refresh();
    } catch (e) {
      setError(errorText(e));
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      mark="mark"
      title="Welcome to LasagnaFi"
      subtitle="Before you continue, please review and accept the terms below."
      footer={<TextLink title="Sign out" onPress={() => void signOut()} muted />}
    >
      <ConsentCheckboxes values={consents} onChange={setConsents} />
      {error ? <Banner>{error}</Banner> : null}
      <Button title="Continue" onPress={() => void submit()} loading={loading} disabled={!allConsented(consents)} />
    </AuthLayout>
  );
}
