import { lazy, Suspense } from 'react';
import { Route, Switch, Redirect, useLocation } from 'wouter';
import { AuthProvider, useAuth } from './lib/auth';
import { ChatStoreProvider } from './lib/chat-store';
import { PageContextProvider } from './lib/page-context';
import { ThemeProvider } from './lib/theme';
import { Login } from './pages/Login';
import { DemoBanner } from './components/common/DemoBanner';
import { ConfirmProvider } from './components/ds';

// Shell pulls framer-motion + mobile/desktop chat panels. Lazy so the
// initial bundle stays small for first paint; Suspense fallback is null
// (the inline skeleton in index.html stays visible until React commits).
const Shell = lazy(() => import('./components/layout/shell').then(m => ({ default: m.Shell })));

// Lazy-load all authenticated pages
const Accounts = lazy(() => import('./pages/Accounts').then(m => ({ default: m.Accounts })));
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
const AccountDetail = lazy(() => import('./pages/account-detail').then(m => ({ default: m.AccountDetail })));

// Design system styleguide — renders OUTSIDE the auth shell (no login required).
const Styleguide = lazy(() => import('./pages/_styleguide').then(m => ({ default: m.Styleguide })));

// Unified pages
const SimpleHome = lazy(() => import('./pages/simple-home').then(m => ({ default: m.SimpleHome })));
const SimpleMoney = lazy(() => import('./pages/simple-money').then(m => ({ default: m.SimpleMoney })));
const ChatFullPage = lazy(() => import('./components/chat/chat-full-page').then(m => ({ default: m.ChatFullPage })));

function AppRoutes() {
  const { user } = useAuth();
  const [location] = useLocation();

  // Public design-system styleguide — no auth shell, no session required.
  if (location.startsWith('/_styleguide')) {
    return (
      <Suspense fallback={null}>
        <Styleguide />
      </Suspense>
    );
  }

  if (!user) {
    return <Login />;
  }

  // Redirect to onboarding if not complete (unless demo mode).
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
              <Shell>
                {import.meta.env.VITE_DEMO_MODE === "true" && <DemoBanner />}
                <Suspense fallback={null}>
                  <Switch>
                    <Route path="/" component={SimpleHome} />
                    <Route path="/money" component={SimpleMoney} />
                    <Route path="/chat" component={ChatFullPage} />

                    {/* Standard pages */}
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
                    <Route path="/retirement" component={Retirement} />
                    <Route path="/probability" component={ProbabilityOfSuccess} />
                    <Route path="/profile" component={Settings} />
                    <Route path="/accounts/:id" component={AccountDetail} />
                    <Route path="/accounts" component={Accounts} />
                    <Route path="/quick-import" component={QuickImport} />

                    {/* Legacy /s/* redirects */}
                    <Route path="/s"><Redirect to="/" /></Route>
                    <Route path="/s/money"><Redirect to="/money" /></Route>
                    <Route path="/s/goals"><Redirect to="/goals" /></Route>
                    <Route path="/s/chat"><Redirect to="/chat" /></Route>
                    <Route path="/s/action"><Redirect to="/insights" /></Route>
                    <Route path="/s/you"><Redirect to="/profile" /></Route>

                    {/* Other redirects */}
                    <Route path="/actions"><Redirect to="/insights" /></Route>
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
    <ThemeProvider>
      <AuthProvider>
        <ConfirmProvider>
          <AppRoutes />
        </ConfirmProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
