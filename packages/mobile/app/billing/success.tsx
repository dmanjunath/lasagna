import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { AuthLayout } from "@/components/auth/AuthKit";
import { openPath } from "@/lib/navigation";
import { Button } from "@/ui/Button";

/** Stripe checkout's return (packages/web/src/pages/billing-success.tsx), reached by its universal link. */
export default function BillingSuccess() {
  const qc = useQueryClient();
  const { status, refresh } = useAuth();
  const { canceled } = useLocalSearchParams<{ canceled?: string }>();
  const wasCanceled = canceled !== undefined;

  // The plan changes outside the app, so read it again now.
  useEffect(() => {
    if (status !== "signedIn") return;
    void refresh();
    void qc.invalidateQueries({ queryKey: ["billing-status"] });
  }, [status, refresh, qc]);

  const onward = () => {
    if (status !== "signedIn") return router.replace("/sign-in");
    router.replace("/");
    openPath("/profile#billing");
  };

  return (
    <AuthLayout
      // A paid plan is a win: the happy mascot, where the theme has one.
      mark={wasCanceled ? "mark" : "mascot"}
      title={wasCanceled ? "Checkout canceled" : "Payment complete"}
      subtitle={wasCanceled ? "No charge was made. Your plan is unchanged." : "Your plan updates in a moment."}
    >
      <Button title="Continue" onPress={onward} />
    </AuthLayout>
  );
}
