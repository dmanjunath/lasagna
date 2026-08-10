import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "./api";
import { isNativeApp } from "./native";

export type BillingStatus = Awaited<ReturnType<typeof api.getBillingStatus>>;

export function useBilling() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // silent = background refresh: don't flash skeletons and don't wipe a good
  // plan on a transient failure (e.g. the radio waking up on resume).
  const refresh = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    api.getBillingStatus()
      .then(setStatus)
      .catch(() => { if (!opts?.silent) setStatus(null); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Native shell: checkout/portal run in an external browser sheet. Refetch the
  // plan when the app returns to the foreground, and — when the sheet closes —
  // poll for a few seconds, since the Stripe webhook that flips the plan can lag
  // behind the user tapping Done.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const onResume = () => refresh({ silent: true });
    const onBrowserClosed = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [0, 2500, 6000].map((d) => setTimeout(() => refresh({ silent: true }), d));
    };
    window.addEventListener("native:resume", onResume);
    window.addEventListener("native:browser-closed", onBrowserClosed);
    return () => {
      window.removeEventListener("native:resume", onResume);
      window.removeEventListener("native:browser-closed", onBrowserClosed);
      timers.current.forEach(clearTimeout);
    };
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
  const { url } = await api.openBillingPortal(isNativeApp() ? { native: true } : undefined);
  if (url) await openStripeUrl(url);
}
