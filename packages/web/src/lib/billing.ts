import { useState, useEffect, useCallback } from "react";
import { api } from "./api";

export type BillingStatus = Awaited<ReturnType<typeof api.getBillingStatus>>;

export function useBilling() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getBillingStatus().then(setStatus).catch(() => setStatus(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { status, loading, refresh };
}

/** Redirect to Stripe Checkout. Throws if the API call fails (caller can toast). */
export async function startUpgrade(): Promise<void> {
  const { url } = await api.startCheckout();
  if (url) window.location.href = url;
}

/** Redirect to the Stripe Billing Portal. */
export async function openPortal(): Promise<void> {
  const { url } = await api.openBillingPortal();
  if (url) window.location.href = url;
}
