import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Building2, Plus, Trash2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
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
  const { logout } = useAuth();
  const [, navigate] = useLocation();
  const [items, setItems] = useState<PlaidItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  const loadItems = () => {
    setLoading(true);
    api.getItems()
      .then((d) => setItems(d.items))
      .catch(() => setError("Failed to load accounts"))
      .finally(() => setLoading(false));
  };

  useEffect(loadItems, []);

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
          await api.exchangeToken({
            publicToken,
            institutionId: metadata.institution?.institution_id,
            institutionName: metadata.institution?.name,
          });
          loadItems();
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
        className="mb-8"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">
              Linked Accounts
            </h1>
            <p className="text-text-muted mt-2">
              Connect your bank accounts for real-time financial tracking
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => navigate("/")}>
              Dashboard
            </Button>
            <Button variant="secondary" onClick={logout}>
              Log Out
            </Button>
          </div>
        </div>
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

      <div className="mb-8">
        <Button onClick={handleLink} disabled={linking}>
          {linking ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Linking...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Link Bank Account
            </span>
          )}
        </Button>
      </div>

      <Section title="Your Institutions">
        {loading ? (
          <div className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-8 h-8 text-text-muted animate-spin mb-4" />
            <p className="text-text-muted">Loading accounts...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center">
            <Building2 className="w-12 h-12 text-text-muted mb-4" />
            <p className="text-text-muted">No bank accounts linked yet.</p>
            <p className="text-sm text-text-muted mt-2">
              Click "Link Bank Account" to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className="glass-card rounded-2xl overflow-hidden"
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
                        <p className="text-sm text-text-muted flex items-center gap-1.5">
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
                        statusColors[item.status] || "bg-surface text-text-muted"
                      )}
                    >
                      {item.status}
                    </span>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                      title="Remove institution"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {item.accounts.length > 0 && (
                  <div className="divide-y divide-border">
                    {item.accounts.map((account) => (
                      <div
                        key={account.id}
                        className="p-4 md:p-5 flex items-center justify-between hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-sm font-medium text-text truncate">
                            {account.name}
                          </span>
                          {account.mask && (
                            <span className="text-sm text-text-muted flex-shrink-0">
                              ••{account.mask}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-text tabular-nums">
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
