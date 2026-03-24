import { Route, Switch } from 'wouter';
import { AuthProvider, useAuth } from './lib/auth';
import { Shell } from './components/layout/shell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { NetWorth } from './pages/net-worth';
import { CashFlow } from './pages/cash-flow';
import { TaxStrategy } from './pages/tax-strategy';
import { Retirement } from './pages/retirement';
import { SavingsGoal } from './pages/savings-goal';
import { DebtPayoff } from './pages/debt-payoff';
import { PlansPage } from './pages/plans/index';
import { NewPlanPage } from './pages/plans/new';
import { PlanDetailPage } from './pages/plans/[id]';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/net-worth" component={NetWorth} />
        <Route path="/cash-flow" component={CashFlow} />
        <Route path="/tax-history" component={TaxStrategy} />
        <Route path="/plans" component={PlansPage} />
        <Route path="/plans/new" component={NewPlanPage} />
        <Route path="/plans/:id" component={PlanDetailPage} />
        <Route path="/plans/retirement" component={Retirement} />
        <Route path="/plans/savings/:id" component={SavingsGoal} />
        <Route path="/plans/debt-payoff" component={DebtPayoff} />
        <Route>
          <div className="flex-1 flex items-center justify-center text-text-muted">
            Page not found
          </div>
        </Route>
      </Switch>
    </Shell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
