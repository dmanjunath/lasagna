let loading: Promise<void> | null = null;

/** Lazily load the Plaid Link SDK script on first use. */
export function loadPlaidSdk(): Promise<void> {
  if ((window as any).Plaid) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Plaid SDK"));
    document.head.appendChild(script);
  });

  return loading;
}
