import { lazy, Suspense, useEffect } from 'react';
import { Route, Switch, Redirect, useLocation } from 'wouter';
import { AuthProvider, useAuth } from './lib/auth';
import { ChatStoreProvider } from './lib/chat-store';
import { PageContextProvider } from './lib/page-context';
import { useIsMobile } from './lib/hooks/use-mobile';
import { Login } from './pages/Login';
import { DemoBanner } from './components/common/DemoBanner';

// Shell pulls framer-motion + mobile/desktop chat panels. Lazy so the
// initial bundle stays small for first paint; Suspense fallback is null
// (the inline skeleton in index.html stays visible until React commits).
const Shell = lazy(() => import('./components/layout/shell').then(m => ({ default: m.Shell })));

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
const QuickImport = lazy(() => import('./pages/quick-import').then(m => ({ default: m.QuickImport })));

// Simple mode (subset for new-to-finance users)
const SimpleHome = lazy(() => import('./pages/simple-home').then(m => ({ default: m.SimpleHome })));
const SimpleMoney = lazy(() => import('./pages/simple-money').then(m => ({ default: m.SimpleMoney })));
const SimpleChat = lazy(() => import('./pages/simple-chat').then(m => ({ default: m.SimpleChat })));
const SimpleGoals = lazy(() => import('./pages/simple-goals').then(m => ({ default: m.SimpleGoals })));
const SimpleAction = lazy(() => import('./pages/simple-action').then(m => ({ default: m.SimpleAction })));

function AppRoutes() {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();
  // Simple mode is mobile-only. On tablet/desktop the user always gets the
  // Advanced experience regardless of their saved `uiMode` preference, and
  // any /s/* route redirects to its Advanced equivalent. The saved mode is
  // preserved server-side so that the same account, when reopened on a
  // phone, lands back in Simple.
  const isMobile = useIsMobile();

  useEffect(() => {
    if (loading || !user) return;
    // Auto-redirect simple-mode users from "/" to "/s" — but only on mobile.
    if (isMobile && user.uiMode === 'simple' && location === '/') {
      setLocation('/s');
      return;
    }
    // Bump any /s/* route to Advanced on tablet+desktop.
    if (!isMobile && location.startsWith('/s')) {
      setLocation('/');
    }
  }, [loading, user, location, setLocation, isMobile]);

  // No more blank-screen gate on the /me round-trip. We render optimistically
  // based on the localStorage auth hint hydrated in AuthProvider; if /me later
  // 401s, the user state flips to null and Login swaps in. Worst case: a brief
  // flash of the app shell for a logged-out user with a stale hint.

  if (!user) {
    return <Login />;
  }

  // Redirect to onboarding if not complete (unless demo mode).
  // Quick Import is reachable from inside the onboarding flow as a shortcut,
  // so allow that path through without rerouting back to the form.
  if (
    user.onboardingStage !== null &&
    import.meta.env.VITE_DEMO_MODE !== "true" &&
    !location.startsWith('/quick-import')
  ) {
    return (
      <Suspense fallback={null}>
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
              <Suspense fallback={null}>
                <Switch>
                  {/* Simple mode — bypasses the Advanced Shell entirely */}
                  <Route path="/s" component={SimpleHome} />
                  <Route path="/s/money" component={SimpleMoney} />
                  <Route path="/s/chat" component={SimpleChat} />
                  <Route path="/s/goals" component={SimpleGoals} />
                  <Route path="/s/you"><Redirect to="/profile" /></Route>
                  <Route path="/s/action" component={SimpleAction} />

                  {/* Unified cross-mode pages — render with SimpleShell, not the
                      Advanced Shell, so both Simple and Advanced users share the
                      exact same Profile / Accounts UI. */}
                  <Route path="/profile" component={Settings} />
                  <Route path="/accounts" component={Accounts} />
                  <Route path="/quick-import" component={QuickImport} />

                  {/* Advanced mode — everything else */}
                  <Route>
                    <Shell>
                      {import.meta.env.VITE_DEMO_MODE === "true" && <DemoBanner />}
                      <Suspense fallback={null}>
                        <Switch>
                          <Route path="/" component={Dashboard} />
                          <Route path="/spending" component={Spending} />
                          <Route path="/goals" component={Goals} />
                          <Route path="/debt" component={Debt} />
                          <Route path="/portfolio" component={PortfolioComposition} />
                          <Route path="/tax" component={TaxStrategy} />
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
                  </Route>
                </Switch>
              </Suspense>
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
