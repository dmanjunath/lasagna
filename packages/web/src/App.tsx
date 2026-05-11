import { lazy, Suspense } from 'react';
import { Route, Switch, Redirect } from 'wouter';
import { AuthProvider, useAuth } from './lib/auth';
import { ChatStoreProvider } from './lib/chat-store';
import { PageContextProvider } from './lib/page-context';
import { Shell } from './components/layout/shell';
import { Login } from './pages/Login';
import { DemoBanner } from './components/common/DemoBanner';
import { LoadingScreen, PageLoader } from './components/common/LoadingScreen';

// Lazy-load all authenticated pages
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Accounts = lazy(() => import('./pages/Accounts').then(m => ({ default: m.Accounts })));
const NetWorth = lazy(() => import('./pages/net-worth').then(m => ({ default: m.NetWorth })));
const TaxStrategy = lazy(() => import('./pages/tax-strategy').then(m => ({ default: m.TaxStrategy })));
const Retirement = lazy(() => import('./pages/retirement').then(m => ({ default: m.Retirement })));
const SavingsGoal = lazy(() => import('./pages/savings-goal').then(m => ({ default: m.SavingsGoal })));
const PortfolioComposition = lazy(() => import('./pages/portfolio-composition'));
const ProbabilityOfSuccess = lazy(() => import('./pages/probability-of-success').then(m => ({ default: m.ProbabilityOfSuccess })));
const PlansPage = lazy(() => import('./pages/plans/index').then(m => ({ default: m.PlansPage })));
const NewPlanPage = lazy(() => import('./pages/plans/new').then(m => ({ default: m.NewPlanPage })));
const PlanDetailPage = lazy(() => import('./pages/plans/[id]').then(m => ({ default: m.PlanDetailPage })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Debt = lazy(() => import('./pages/debt').then(m => ({ default: m.Debt })));
const Spending = lazy(() => import('./pages/spending').then(m => ({ default: m.Spending })));
const Goals = lazy(() => import('./pages/goals').then(m => ({ default: m.Goals })));
const FinancialLevel = lazy(() => import('./pages/financial-level').then(m => ({ default: m.FinancialLevel })));
const Insights = lazy(() => import('./pages/insights').then(m => ({ default: m.Insights })));
const Onboarding = lazy(() => import('./pages/onboarding').then(m => ({ default: m.Onboarding })));

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Login />;
  }

  // Redirect to onboarding if not complete (unless demo mode)
  if (user.onboardingStage !== null && import.meta.env.VITE_DEMO_MODE !== "true") {
    return (
      <Suspense fallback={<PageLoader />}>
        <Onboarding />
      </Suspense>
    );
  }

  return (
    <Switch>
      <Route path="/onboarding">
        <Redirect to="/" />
      </Route>
      <Route>
        {() => (
          <ChatStoreProvider>
          <PageContextProvider>
            <Shell>
              {import.meta.env.VITE_DEMO_MODE === "true" && <DemoBanner />}
              <Suspense fallback={<PageLoader />}>
                <Switch>
                  <Route path="/" component={Dashboard} />
                  <Route path="/accounts" component={Accounts} />
                  <Route path="/spending" component={Spending} />
                  <Route path="/goals" component={Goals} />
                  <Route path="/debt" component={Debt} />
                  <Route path="/portfolio" component={PortfolioComposition} />
                  <Route path="/tax" component={TaxStrategy} />
                  <Route path="/profile" component={Settings} />
                  <Route path="/plans" component={PlansPage} />
                  <Route path="/plans/new" component={NewPlanPage} />
                  <Route path="/plans/:id" component={PlanDetailPage} />
                  <Route path="/plans/retirement" component={Retirement} />
                  <Route path="/plans/savings/:id" component={SavingsGoal} />
                  <Route path="/financial-level" component={FinancialLevel} />
                  <Route path="/insights" component={Insights} />
                  <Route path="/actions"><Redirect to="/insights" /></Route>
                  <Route path="/retirement" component={Retirement} />
                  <Route path="/probability" component={ProbabilityOfSuccess} />

                  <Route path="/net-worth" component={NetWorth} />

                  {/* Redirects */}
                  <Route path="/login"><Redirect to="/" /></Route>

                  <Route path="/priorities"><Redirect to="/financial-level" /></Route>
                  <Route path="/tax-history"><Redirect to="/tax" /></Route>
                  <Route path="/settings"><Redirect to="/profile" /></Route>

                  <Route>
                    <div className="flex-1 flex items-center justify-center text-text-secondary">
                      Page not found
                    </div>
                  </Route>
                </Switch>
              </Suspense>
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
