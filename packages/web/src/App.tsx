import { Route, Switch, Redirect } from 'wouter';
import { AuthProvider, useAuth } from './lib/auth';
import { ChatStoreProvider } from './lib/chat-store';
import { PageContextProvider } from './lib/page-context';
import { Shell } from './components/layout/shell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { NetWorth } from './pages/net-worth';
import { TaxStrategy } from './pages/tax-strategy';
import { Retirement } from './pages/retirement';
import { SavingsGoal } from './pages/savings-goal';
import PortfolioComposition from './pages/portfolio-composition';
import { ProbabilityOfSuccess } from './pages/probability-of-success';
import { PlansPage } from './pages/plans/index';
import { NewPlanPage } from './pages/plans/new';
import { PlanDetailPage } from './pages/plans/[id]';
import { Settings } from './pages/Settings';
import { Debt } from './pages/debt';
import { Spending } from './pages/spending';
import { Goals } from './pages/goals';
import { Priorities } from './pages/priorities';
import { Onboarding } from './pages/onboarding';
import { DemoBanner } from './components/common/DemoBanner';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-secondary">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Switch>
      <Route path="/onboarding">
        {import.meta.env.VITE_DEMO_MODE === "true"
          ? <Redirect to="/" />
          : <Onboarding />}
      </Route>
      <Route>
        {() => (
          <ChatStoreProvider>
          <PageContextProvider>
            <Shell>
              {import.meta.env.VITE_DEMO_MODE === "true" && <DemoBanner />}
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/accounts" component={Accounts} />
                <Route path="/spending" component={Spending} />
                <Route path="/goals" component={Goals} />
                <Route path="/debt" component={Debt} />
                <Route path="/invest" component={PortfolioComposition} />
                <Route path="/tax" component={TaxStrategy} />
                <Route path="/profile" component={Settings} />
                <Route path="/plans" component={PlansPage} />
                <Route path="/plans/new" component={NewPlanPage} />
                <Route path="/plans/:id" component={PlanDetailPage} />
                <Route path="/plans/retirement" component={Retirement} />
                <Route path="/plans/savings/:id" component={SavingsGoal} />
                <Route path="/priorities" component={Priorities} />
                <Route path="/actions"><Redirect to="/priorities" /></Route>
                <Route path="/insights"><Redirect to="/priorities" /></Route>
                <Route path="/retirement" component={Retirement} />
                <Route path="/probability" component={ProbabilityOfSuccess} />

                <Route path="/net-worth" component={NetWorth} />

                {/* Redirects */}
                <Route path="/login"><Redirect to="/" /></Route>
                <Route path="/portfolio"><Redirect to="/invest" /></Route>
                <Route path="/tax-history"><Redirect to="/tax" /></Route>
                <Route path="/settings"><Redirect to="/profile" /></Route>

                <Route>
                  <div className="flex-1 flex items-center justify-center text-text-secondary">
                    Page not found
                  </div>
                </Route>
              </Switch>
            </Shell>
          </PageContextProvider>
          </ChatStoreProvider>
        )}
      </Route>
    </Switch>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
