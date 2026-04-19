import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { Building2, Plus, Trash2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/button.js";
import { Section } from "../components/common/section.js";
import { cn } from "../lib/utils.js";

function formatCurrency(value: string, currency: string): string {
  const num = parseFloat(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(num);
}

interface Account {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  balance: string | null;
  currency: string;
}

interface PlaidItem {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accounts: Account[];
}

export function Accounts() {
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [newlyLinkedId, setNewlyLinkedId] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadItems = (showLoader = true) => {
    if (showLoader) setLoading(true);
    api.getItems()
      .then((d) => setItems(d.items))
      .catch(() => setError("Failed to load accounts"))
      .finally(() => setLoading(false));
  };

  useEffect(() => loadItems(), []);

  // Auto-open Plaid Link if navigated with ?autoLink=true (from onboarding)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autoLink') === 'true') {
      // Clean up the URL
      window.history.replaceState({}, '', '/accounts');
      // Small delay to let the page render first
      const timer = setTimeout(() => handleLink(), 300);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLink = async () => {
    setLinking(true);
    setError("");
    try {
      const { linkToken } = await api.createLinkToken();

      // Plaid Link is loaded via script tag in index.html
      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError("Plaid Link script not loaded. Add it to index.html.");
        setLinking(false);
        return;
      }

      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken: string, metadata: PlaidMetadata) => {
          try {
            await api.exchangeToken({
              publicToken,
              institutionId: metadata.institution?.institution_id,
              institutionName: metadata.institution?.name,
            });
            // Sync runs async on the server — poll until accounts appear
            setSyncing(true);
            let attempts = 0;
            const poll = setInterval(async () => {
              attempts++;
              try {
                const data = await api.getItems();
                // Check if the new institution has accounts yet
                const newInst = data.items.find(
                  (i) => i.institutionName === metadata.institution?.name
                );
                if ((newInst && newInst.accounts.length > 0) || attempts >= 10) {
                  clearInterval(poll);
                  setItems(data.items);
                  setSyncing(false);
                  setLinking(false);

                  // Highlight the new institution and scroll to it
                  if (newInst) {
                    setNewlyLinkedId(newInst.id);
                    setTimeout(() => {
                      itemRefs.current[newInst.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 100);
                    setTimeout(() => setNewlyLinkedId(null), 3000);

                    // Regenerate insights with the new account data
                    api.generateInsights().catch(() => {});
                  }
                }
              } catch {
                clearInterval(poll);
                setSyncing(false);
                setLinking(false);
              }
            }, 2000);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to link account");
            setLinking(false);
          }
        },
        onExit: () => setLinking(false),
      });

      handler.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start linking");
      setLinking(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteItem(id);
    loadItems();
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setError("");
    try {
      await api.triggerSync();
      loadItems(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync accounts");
    } finally {
      setSyncing(false);
    }
  };

  const statusColors: Record<string, string> = {
    healthy: "bg-success/20 text-success",
    error: "bg-danger/20 text-danger",
    pending: "bg-warning/20 text-warning",
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">
            Linked Accounts
          </h1>
          <p className="text-text-secondary mt-2">
            Connect your bank accounts for real-time financial tracking
          </p>
        </div>
        {import.meta.env.VITE_DEMO_MODE !== "true" && (
          <div className="flex items-center gap-3 flex-shrink-0 pt-1">
            <Button onClick={handleLink} disabled={linking}>
              {linking ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Linking...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Link Account
                </span>
              )}
            </Button>
            {items.length > 0 && (
              <Button variant="secondary" onClick={handleSyncAll} disabled={syncing}>
                {syncing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Syncing...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Sync All
                  </span>
                )}
              </Button>
            )}
          </div>
        )}
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-xl bg-danger/10 border border-danger/20 flex items-center gap-3 text-danger"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </motion.div>
      )}

      <Section title="Your Institutions">
        {loading ? (
          <div className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-8 h-8 text-text-secondary animate-spin mb-4" />
            <p className="text-text-secondary">Loading accounts...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center">
            <Building2 className="w-12 h-12 text-text-secondary mb-4" />
            <p className="text-text-secondary">No bank accounts linked yet.</p>
            <p className="text-sm text-text-secondary mt-2">
              Click "Link Account" to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                ref={(el) => { itemRefs.current[item.id] = el; }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className={cn(
                  "glass-card rounded-2xl overflow-hidden transition-all duration-700",
                  newlyLinkedId === item.id && "ring-2 ring-accent/50 shadow-[0_0_20px_rgba(52,199,89,0.25)]"
                )}
              >
                <div className="p-4 md:p-5 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h3 className="font-medium text-text">
                        {item.institutionName ?? "Unknown Bank"}
                      </h3>
                      {item.lastSyncedAt && (
                        <p className="text-sm text-text-secondary flex items-center gap-1.5">
                          <RefreshCw className="w-3 h-3" />
                          Last synced: {new Date(item.lastSyncedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium capitalize",
                        statusColors[item.status] || "bg-surface text-text-secondary"
                      )}
                    >
                      {item.status}
                    </span>
                    {import.meta.env.VITE_DEMO_MODE !== "true" && (
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 rounded-lg text-text-secondary hover:text-danger hover:bg-danger/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                        title="Remove institution"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {item.accounts.length === 0 && syncing && (
                  <div className="p-4 md:p-5 flex items-center gap-3 text-text-secondary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Syncing accounts...</span>
                  </div>
                )}
                {item.accounts.length === 0 && !syncing && (
                  <div className="p-4 md:p-5 text-sm text-text-secondary">
                    No accounts found for this institution.
                  </div>
                )}
                {item.accounts.length > 0 && (
                  <div className="divide-y divide-border">
                    {item.accounts.map((account) => (
                      <div
                        key={account.id}
                        className="p-4 md:p-5 flex items-center justify-between hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-sm font-medium text-text truncate max-w-[200px] md:max-w-[300px]" title={account.name}>
                            {account.name}
                          </span>
                          {account.mask && (
                            <span className="text-sm text-text-secondary flex-shrink-0">
                              ••{account.mask}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-text tabular-nums flex-shrink-0 ml-4">
                          {account.balance !== null
                            ? formatCurrency(account.balance, account.currency)
                            : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// Plaid Link types
interface PlaidLinkFactory {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
    onExit: () => void;
  }) => { open: () => void };
}

interface PlaidMetadata {
  institution?: {
    institution_id: string;
    name: string;
  };
}
