import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

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
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");

  const loadItems = () => {
    api.getItems().then((d) => setItems(d.items)).catch(() => {});
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

  return (
    <div className="dashboard">
      <header>
        <div>
          <h1>Linked Accounts</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate("/")}>Dashboard</button>
          <button onClick={logout}>Log Out</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <button className="primary" onClick={handleLink} disabled={linking}>
        {linking ? "Linking..." : "+ Link Bank Account"}
      </button>

      {items.length === 0 ? (
        <p className="empty">No bank accounts linked yet.</p>
      ) : (
        <div className="items-list">
          {items.map((item) => (
            <div key={item.id} className="item-card">
              <div className="item-header">
                <strong>{item.institutionName ?? "Unknown Bank"}</strong>
                <span className={`status ${item.status}`}>{item.status}</span>
              </div>
              {item.accounts.length > 0 && (
                <div className="accounts-list">
                  {item.accounts.map((account) => (
                    <div key={account.id} className="account-row">
                      <span className="account-name">
                        {account.name}
                        {account.mask && <span className="mask">••{account.mask}</span>}
                      </span>
                      <span className="account-balance">
                        {account.balance !== null
                          ? formatCurrency(account.balance, account.currency)
                          : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="item-meta">
                {item.lastSyncedAt && (
                  <span>
                    Last synced:{" "}
                    {new Date(item.lastSyncedAt).toLocaleDateString()}
                  </span>
                )}
                <button className="danger" onClick={() => handleDelete(item.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
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
