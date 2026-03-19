import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth.js";
import { api } from "../lib/api.js";
import { useLocation } from "wouter";

interface Balance {
  accountId: string;
  name: string;
  type: string;
  mask: string | null;
  balance: string | null;
  available: string | null;
  currency: string;
  asOf: string | null;
}

interface Holding {
  id: string;
  accountName: string | null;
  tickerSymbol: string | null;
  securityName: string | null;
  quantity: string | null;
  institutionValue: string | null;
  costBasis: string | null;
}

function formatMoney(val: string | null): string {
  if (!val) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(parseFloat(val));
}

export function Dashboard() {
  const { user, tenant, logout } = useAuth();
  const [, navigate] = useLocation();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    api.getBalances().then((d) => setBalances(d.balances)).catch(() => {});
    api.getHoldings().then((d) => setHoldings(d.holdings)).catch(() => {});
  }, []);

  const totalBalance = balances.reduce(
    (sum, b) => sum + parseFloat(b.balance || "0"),
    0,
  );
  const totalInvestments = holdings.reduce(
    (sum, h) => sum + parseFloat(h.institutionValue || "0"),
    0,
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.triggerSync();
      // Refresh after a short delay
      setTimeout(async () => {
        const [b, h] = await Promise.all([
          api.getBalances(),
          api.getHoldings(),
        ]);
        setBalances(b.balances);
        setHoldings(h.holdings);
        setSyncing(false);
      }, 3000);
    } catch {
      setSyncing(false);
    }
  };

  return (
    <div className="dashboard">
      <header>
        <div>
          <h1>Lasagna</h1>
          {tenant && <span className="badge">{tenant.plan}</span>}
        </div>
        <div className="header-actions">
          <span>{user?.email}</span>
          <button onClick={() => navigate("/accounts")}>Accounts</button>
          <button onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync"}
          </button>
          <button onClick={logout}>Log Out</button>
        </div>
      </header>

      <div className="summary-cards">
        <div className="card">
          <h3>Net Worth</h3>
          <p className="amount">{formatMoney(String(totalBalance + totalInvestments))}</p>
        </div>
        <div className="card">
          <h3>Cash</h3>
          <p className="amount">{formatMoney(String(totalBalance))}</p>
        </div>
        <div className="card">
          <h3>Investments</h3>
          <p className="amount">{formatMoney(String(totalInvestments))}</p>
        </div>
      </div>

      <section>
        <h2>Balances</h2>
        {balances.length === 0 ? (
          <p className="empty">
            No accounts linked.{" "}
            <a href="#" onClick={() => navigate("/accounts")}>
              Link a bank account
            </a>
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Balance</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.accountId}>
                  <td>
                    {b.name} {b.mask && <span className="mask">•••{b.mask}</span>}
                  </td>
                  <td>{b.type}</td>
                  <td>{formatMoney(b.balance)}</td>
                  <td>{formatMoney(b.available)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {holdings.length > 0 && (
        <section>
          <h2>Holdings</h2>
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Qty</th>
                <th>Value</th>
                <th>Cost Basis</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td className="ticker">{h.tickerSymbol ?? "—"}</td>
                  <td>{h.securityName}</td>
                  <td>{h.quantity ? parseFloat(h.quantity).toFixed(2) : "—"}</td>
                  <td>{formatMoney(h.institutionValue)}</td>
                  <td>{formatMoney(h.costBasis)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
