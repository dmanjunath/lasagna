import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import { isNativeApp } from "./native";

export type BillingStatus = Awaited<ReturnType<typeof api.getBillingStatus>>;

export function useBilling() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getBillingStatus().then(setStatus).catch(() => setStatus(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Native shell: checkout happens in an external browser sheet, so refetch
  // the plan when the app comes back to the foreground.
  useEffect(() => {
    window.addEventListener("native:resume", refresh);
    return () => window.removeEventListener("native:resume", refresh);
  }, [refresh]);

  return { status, loading, refresh };
}

/** Open a Stripe-hosted URL: browser sheet in the native shell, redirect on web. */
async function openStripeUrl(url: string): Promise<void> {
  if (isNativeApp()) {
    const { Browser } = await import("@capacitor/browser"); // dynamic — keep plugin out of web chunks
    await Browser.open({ url });
  } else {
    window.location.href = url;
  }
}

/** Open Stripe Checkout. Throws if the API call fails (caller can toast). */
export async function startUpgrade(): Promise<void> {
  const { url } = await api.startCheckout(isNativeApp() ? { native: true } : undefined);
  if (url) await openStripeUrl(url);
}

/** Open the Stripe Billing Portal. */
export async function openPortal(): Promise<void> {
  const { url } = await api.openBillingPortal();
  if (url) await openStripeUrl(url);
}
