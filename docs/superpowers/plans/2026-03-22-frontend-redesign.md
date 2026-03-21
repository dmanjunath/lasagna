# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the basic Lasagna dashboard into a polished AI-powered financial planning interface with workspace-style navigation, rich data visualization, and smooth animations.

**Architecture:** Keep existing Wouter routing (lightweight, sufficient). Add Tailwind for styling, shadcn/ui for accessible components, Framer Motion for animations, and Recharts for charts. Build incrementally: foundation → layout → pages.

**Tech Stack:** React 19, Vite, Wouter, Tailwind CSS, shadcn/ui (Radix UI), Framer Motion, Recharts

**Reference:** `mockups/workspace-ui.html`, `docs/superpowers/specs/2026-03-21-frontend-redesign-design.md`

**Scope Notes:**
- **Testing**: Unit tests for utility functions and component tests are deferred to a follow-up testing plan. This plan focuses on establishing the visual foundation.
- **Phase 6 (Page Stubs)**: Creates navigable page stubs with basic layouts. Full implementations matching all spec requirements (chat panels, modals, complex interactions) will be covered in a follow-up plan once the foundation is solid.
- **Task Breakdown**: Large component tasks include internal substeps. Implementers should commit after each logical substep if preferred.

---

## File Structure

```
packages/web/src/
├── main.tsx                    # Entry point (existing)
├── App.tsx                     # Root with auth + routing (modify)
├── index.css                   # Global styles + Tailwind imports (replace)
├── lib/
│   ├── api.ts                  # API client (existing, extend later)
│   ├── auth.tsx                # Auth context (existing)
│   ├── utils.ts                # cn() helper, formatMoney (create)
│   └── hooks/
│       └── use-mobile.ts       # Mobile detection hook (create)
├── components/
│   ├── ui/                     # shadcn/ui components (generated)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── progress.tsx
│   │   ├── tooltip.tsx
│   │   └── ...
│   ├── layout/
│   │   ├── shell.tsx           # Main app shell with sidebar (create)
│   │   ├── sidebar.tsx         # Navigation sidebar (create)
│   │   └── mobile-nav.tsx      # Mobile hamburger + drawer (create)
│   ├── charts/
│   │   ├── area-chart.tsx      # Reusable area chart wrapper (create)
│   │   └── pie-chart.tsx       # Reusable pie chart wrapper (create)
│   └── common/
│       ├── stat-card.tsx       # Stat display card (create)
│       ├── section.tsx         # Section with title + actions (create)
│       └── progress-bar.tsx    # Animated progress bar (create)
├── pages/
│   ├── dashboard.tsx           # Dashboard with todos + summaries (replace)
│   ├── net-worth.tsx           # Net worth with chart + accounts (create)
│   ├── cash-flow.tsx           # Cash flow page (create)
│   ├── tax-strategy.tsx        # Tax strategy page (create)
│   ├── retirement.tsx          # Retirement plan page (create)
│   ├── savings-goal.tsx        # Savings goal page (create)
│   ├── debt-payoff.tsx         # Debt payoff page (create)
│   ├── login.tsx               # Login page (existing, rename)
│   └── accounts.tsx            # Plaid accounts management (existing)
└── styles/
    └── theme.ts                # Design tokens as TS constants (create)
```

---

## Phase 1: Foundation

### Task 1: Install Dependencies

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Install Tailwind CSS and dependencies**

```bash
cd packages/web && pnpm add -D tailwindcss postcss autoprefixer && pnpm dlx tailwindcss init -p
```

- [ ] **Step 2: Install animation and chart libraries**

```bash
cd packages/web && pnpm add framer-motion recharts
```

- [ ] **Step 3: Install shadcn/ui dependencies**

```bash
cd packages/web && pnpm add class-variance-authority clsx tailwind-merge lucide-react @radix-ui/react-slot @radix-ui/react-tooltip @radix-ui/react-progress
```

- [ ] **Step 4: Verify package.json has all dependencies**

Run: `cat packages/web/package.json`
Expected: dependencies include tailwindcss, framer-motion, recharts, class-variance-authority, clsx, tailwind-merge, lucide-react

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json packages/web/pnpm-lock.yaml packages/web/tailwind.config.js packages/web/postcss.config.js
git commit -m "feat(web): add tailwind, framer-motion, recharts, shadcn deps"
```

---

### Task 2: Configure Tailwind with Design Tokens

**Files:**
- Create: `packages/web/tailwind.config.js`
- Create: `packages/web/src/styles/theme.ts`

- [ ] **Step 1: Create theme constants file**

Create `packages/web/src/styles/theme.ts`:

```typescript
export const colors = {
  bg: {
    DEFAULT: '#0c0a09',
    elevated: '#1c1917',
    subtle: '#292524',
  },
  surface: {
    DEFAULT: 'rgba(41, 37, 36, 0.6)',
    solid: '#292524',
    hover: 'rgba(68, 64, 60, 0.5)',
  },
  border: {
    DEFAULT: 'rgba(120, 113, 108, 0.2)',
    light: 'rgba(168, 162, 158, 0.15)',
    accent: 'rgba(251, 191, 36, 0.3)',
  },
  text: {
    DEFAULT: '#fafaf9',
    secondary: '#d6d3d1',
    muted: '#a8a29e',
  },
  accent: {
    DEFAULT: '#fbbf24',
    dim: '#d97706',
    glow: 'rgba(251, 191, 36, 0.15)',
  },
  success: '#4ade80',
  warning: '#fb923c',
  danger: '#f87171',
} as const;

export const fonts = {
  sans: ['DM Sans', 'system-ui', 'sans-serif'],
  display: ['Fraunces', 'Georgia', 'serif'],
} as const;
```

- [ ] **Step 2: Configure Tailwind**

Replace `packages/web/tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        bg: {
          DEFAULT: '#0c0a09',
          elevated: '#1c1917',
          subtle: '#292524',
        },
        surface: {
          DEFAULT: 'rgba(41, 37, 36, 0.6)',
          solid: '#292524',
          hover: 'rgba(68, 64, 60, 0.5)',
        },
        border: {
          DEFAULT: 'rgba(120, 113, 108, 0.2)',
          light: 'rgba(168, 162, 158, 0.15)',
          accent: 'rgba(251, 191, 36, 0.3)',
        },
        text: {
          DEFAULT: '#fafaf9',
          secondary: '#d6d3d1',
          muted: '#a8a29e',
        },
        accent: {
          DEFAULT: '#fbbf24',
          dim: '#d97706',
          glow: 'rgba(251, 191, 36, 0.15)',
        },
        success: '#4ade80',
        warning: '#fb923c',
        danger: '#f87171',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/tailwind.config.js packages/web/src/styles/theme.ts
git commit -m "feat(web): configure tailwind with design tokens"
```

---

### Task 3: Set Up Base Styles and Utilities

**Files:**
- Replace: `packages/web/src/index.css`
- Create: `packages/web/src/lib/utils.ts`
- Modify: `packages/web/index.html`

- [ ] **Step 1: Replace index.css with Tailwind imports and base styles**

Replace `packages/web/src/index.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * {
    @apply border-border;
  }

  body {
    @apply bg-bg text-text font-sans antialiased;
  }

  /* Subtle noise texture overlay */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
    opacity: 0.015;
    pointer-events: none;
    z-index: 1000;
  }
}

@layer components {
  .glass-card {
    @apply bg-gradient-to-br from-surface to-bg-elevated/80 backdrop-blur-xl border border-border rounded-2xl;
    box-shadow: 0 4px 24px -4px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .glass-card-hover {
    @apply transition-all duration-300;
  }

  .glass-card-hover:hover {
    @apply border-accent/20;
    box-shadow: 0 8px 32px -4px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(251, 191, 36, 0.1);
    transform: translateY(-1px);
  }

  .stat-card {
    @apply relative bg-gradient-to-br from-bg-elevated to-bg;
  }

  .stat-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(135deg, rgba(120, 113, 108, 0.3) 0%, rgba(120, 113, 108, 0.1) 50%, rgba(120, 113, 108, 0.2) 100%);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  .accent-glow {
    box-shadow: 0 0 20px rgba(251, 191, 36, 0.2);
  }

  .progress-glow {
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.4);
  }
}

@layer utilities {
  .tabular-nums {
    font-variant-numeric: tabular-nums;
  }

  .scrollbar-thin::-webkit-scrollbar {
    width: 6px;
  }

  .scrollbar-thin::-webkit-scrollbar-track {
    background: transparent;
  }

  .scrollbar-thin::-webkit-scrollbar-thumb {
    background: rgba(120, 113, 108, 0.3);
    border-radius: 3px;
  }
}
```

- [ ] **Step 2: Create utils.ts with cn helper and formatMoney**

Create `packages/web/src/lib/utils.ts`:

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value: number | string | null, compact = false): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '—';

  if (compact && Math.abs(num) >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(num);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
```

- [ ] **Step 3: Verify Tailwind processes correctly**

Run: `cd packages/web && pnpm dev`
Expected: Dev server starts without Tailwind errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/index.css packages/web/src/lib/utils.ts
git commit -m "feat(web): add base styles with glass cards and utility helpers"
```

---

### Task 4: Create Base UI Components

**Files:**
- Create: `packages/web/src/components/ui/button.tsx`
- Create: `packages/web/src/components/ui/card.tsx`
- Create: `packages/web/src/components/ui/progress.tsx`

- [ ] **Step 1: Create Button component**

Create `packages/web/src/components/ui/button.tsx`:

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-gradient-to-r from-accent to-accent-dim text-bg hover:opacity-90 accent-glow',
        secondary: 'glass-card glass-card-hover',
        ghost: 'hover:bg-surface-hover',
        outline: 'border border-border hover:border-accent/30 hover:bg-surface-hover',
        danger: 'text-danger border border-danger/30 hover:bg-danger/10',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

- [ ] **Step 2: Create Card component**

Create `packages/web/src/components/ui/card.tsx`:

```tsx
import * as React from 'react';
import { cn } from '../../lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('glass-card p-6', className)} {...props} />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-display text-lg font-medium', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('pt-4', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardTitle, CardContent };
```

- [ ] **Step 3: Create Progress component**

Create `packages/web/src/components/ui/progress.tsx`:

```tsx
import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../../lib/utils';

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { glow?: boolean }
>(({ className, value, glow, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-solid', className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        'h-full bg-gradient-to-r from-accent to-accent-dim rounded-full transition-all duration-700',
        glow && 'progress-glow'
      )}
      style={{ width: `${value || 0}%` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = 'Progress';

export { Progress };
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/ui/
git commit -m "feat(web): add button, card, progress UI components"
```

---

## Phase 2: Layout & Navigation

### Task 5: Create Mobile Detection Hook

**Files:**
- Create: `packages/web/src/lib/hooks/use-mobile.ts`

- [ ] **Step 1: Create use-mobile hook**

Create `packages/web/src/lib/hooks/use-mobile.ts`:

```typescript
import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    mql.addEventListener('change', onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/hooks/use-mobile.ts
git commit -m "feat(web): add useIsMobile hook"
```

---

### Task 6: Create Sidebar Component

**Files:**
- Create: `packages/web/src/components/layout/sidebar.tsx`

**Substeps (commit after each if preferred):**
1. Create file with imports, interfaces, and navigation data
2. Add Logo and fixed tabs section
3. Add collapsible user plans section with animations
4. Add user profile footer

- [ ] **Step 1: Create Sidebar component**

Create `packages/web/src/components/layout/sidebar.tsx`:

```tsx
import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { Progress } from '../ui/progress';

interface NavItem {
  id: string;
  name: string;
  icon: string;
  path: string;
  version?: string;
  progress?: number;
}

const fixedTabs: NavItem[] = [
  { id: 'dashboard', name: 'Overview', icon: '◐', path: '/' },
  { id: 'net-worth', name: 'Net Worth', icon: '◈', path: '/net-worth' },
  { id: 'cash-flow', name: 'Cash Flow', icon: '◉', path: '/cash-flow' },
  { id: 'tax-strategy', name: 'Tax Strategy', icon: '◇', path: '/tax-strategy' },
];

// TODO: These will come from API later
const userPlans: NavItem[] = [
  { id: 'retirement', name: 'Retirement Plan', icon: '◎', path: '/plans/retirement', version: 'v3' },
  { id: 'savings-house', name: 'House Down Payment', icon: '◎', path: '/plans/savings/house', progress: 45 },
  { id: 'savings-vacation', name: 'Europe Vacation', icon: '◎', path: '/plans/savings/vacation', progress: 72 },
  { id: 'debt-payoff', name: 'Debt Payoff', icon: '◆', path: '/plans/debt-payoff' },
];

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ onNewPlan, className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const [plansExpanded, setPlansExpanded] = useState(true);

  const isActive = (path: string) => location === path;

  return (
    <aside className={cn('w-64 h-full bg-bg-elevated border-r border-border flex flex-col', className)}>
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <h1 className="font-display text-xl font-medium tracking-tight flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center text-bg text-sm font-bold shadow-lg">
            L
          </span>
          <span>Lasagna</span>
        </h1>
        <p className="text-sm text-text-muted mt-1.5 ml-12">AI Financial Advisor</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto scrollbar-thin">
        {/* Fixed Tabs */}
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-text-secondary font-semibold mb-3 px-2">
            Dashboard
          </div>
          <div className="space-y-1">
            {fixedTabs.map((tab) => (
              <motion.button
                key={tab.id}
                onClick={() => navigate(tab.path)}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  'w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200',
                  isActive(tab.path)
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
                )}
              >
                <span className={cn('text-lg', isActive(tab.path) ? 'text-accent' : 'text-text-muted')}>
                  {tab.icon}
                </span>
                <span className="flex-1 font-medium">{tab.name}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* User Plans */}
        <div>
          <button
            onClick={() => setPlansExpanded(!plansExpanded)}
            className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-text-secondary font-semibold mb-3 px-2 hover:text-text transition-colors"
          >
            <span>Your Plans</span>
            <motion.span
              animate={{ rotate: plansExpanded ? 0 : -90 }}
              transition={{ duration: 0.2 }}
            >
              ▾
            </motion.span>
          </button>

          <AnimatePresence>
            {plansExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-1 overflow-hidden"
              >
                {userPlans.map((plan) => (
                  <motion.button
                    key={plan.id}
                    onClick={() => navigate(plan.path)}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200',
                      isActive(plan.path)
                        ? 'bg-accent/10 text-accent border border-accent/20'
                        : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
                    )}
                  >
                    <span className={cn('text-lg', isActive(plan.path) ? 'text-accent' : 'text-text-muted')}>
                      {plan.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{plan.name}</div>
                      {plan.progress !== undefined && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <Progress value={plan.progress} className="flex-1 h-1" />
                          <span className="text-xs text-text-muted tabular-nums">{plan.progress}%</span>
                        </div>
                      )}
                    </div>
                    {plan.version && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-surface-solid text-text-muted">
                        {plan.version}
                      </span>
                    )}
                  </motion.button>
                ))}

                <motion.button
                  onClick={onNewPlan}
                  whileHover={{ x: 2 }}
                  className="w-full px-3 py-3 rounded-xl text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all duration-200 flex items-center gap-3 border border-dashed border-border/50 hover:border-accent/30 mt-2"
                >
                  <span className="text-lg">+</span>
                  <span className="font-medium">New Plan</span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* User profile */}
      <div className="p-4 border-t border-border bg-bg/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/20 to-accent-dim/20 border border-accent/20 flex items-center justify-center text-sm font-semibold text-accent">
            DM
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">User</div>
            <div className="text-sm text-text-muted truncate">Pro Plan</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/layout/sidebar.tsx
git commit -m "feat(web): add animated sidebar with navigation"
```

---

### Task 7: Create Mobile Navigation

**Files:**
- Create: `packages/web/src/components/layout/mobile-nav.tsx`

- [ ] **Step 1: Create MobileNav component**

Create `packages/web/src/components/layout/mobile-nav.tsx`:

```tsx
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './sidebar';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  onNewPlan?: () => void;
}

export function MobileNav({ isOpen, onClose, onNewPlan }: MobileNavProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-y-0 left-0 z-50 md:hidden"
          >
            <Sidebar
              onNewPlan={() => {
                onNewPlan?.();
                onClose();
              }}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className="md:hidden fixed top-4 left-4 z-30 w-10 h-10 rounded-xl bg-surface-solid border border-border flex items-center justify-center"
    >
      <span className="text-lg">☰</span>
    </motion.button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/layout/mobile-nav.tsx
git commit -m "feat(web): add mobile navigation drawer"
```

---

### Task 8: Create Shell Layout

**Files:**
- Create: `packages/web/src/components/layout/shell.tsx`
- Modify: `packages/web/src/App.tsx`

**Substeps:**
1. Create Shell component with mobile state management
2. Update App.tsx to wrap routes in Shell
3. Add placeholder routes for all pages

- [ ] **Step 1: Create Shell component**

Create `packages/web/src/components/layout/shell.tsx`:

```tsx
import { useState } from 'react';
import { Sidebar } from './sidebar';
import { MobileNav, MobileMenuButton } from './mobile-nav';
import { useIsMobile } from '../../lib/hooks/use-mobile';

interface ShellProps {
  children: React.ReactNode;
}

export function Shell({ children }: ShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleNewPlan = () => {
    // TODO: Open new plan modal
    console.log('New plan clicked');
  };

  return (
    <div className="flex h-screen bg-bg">
      {/* Mobile menu button */}
      {isMobile && <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />}

      {/* Mobile drawer */}
      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onNewPlan={handleNewPlan}
      />

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar onNewPlan={handleNewPlan} />
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx to use Shell**

Replace `packages/web/src/App.tsx`:

```tsx
import { Route, Switch } from 'wouter';
import { AuthProvider, useAuth } from './lib/auth';
import { Shell } from './components/layout/shell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';

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
        <Route path="/net-worth">
          <div className="p-8 text-text-muted">Net Worth page coming soon...</div>
        </Route>
        <Route path="/cash-flow">
          <div className="p-8 text-text-muted">Cash Flow page coming soon...</div>
        </Route>
        <Route path="/tax-strategy">
          <div className="p-8 text-text-muted">Tax Strategy page coming soon...</div>
        </Route>
        <Route path="/plans/retirement">
          <div className="p-8 text-text-muted">Retirement Plan page coming soon...</div>
        </Route>
        <Route path="/plans/savings/:id">
          <div className="p-8 text-text-muted">Savings Goal page coming soon...</div>
        </Route>
        <Route path="/plans/debt-payoff">
          <div className="p-8 text-text-muted">Debt Payoff page coming soon...</div>
        </Route>
        <Route>
          <div className="p-8 text-text-muted">Page not found</div>
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
```

- [ ] **Step 3: Verify layout works**

Run: `cd packages/web && pnpm dev`
Expected: App shows sidebar on desktop, hamburger menu on mobile

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/layout/shell.tsx packages/web/src/App.tsx
git commit -m "feat(web): add shell layout with responsive sidebar"
```

---

## Phase 3: Common Components

### Task 9: Create Stat Card and Section Components

**Files:**
- Create: `packages/web/src/components/common/stat-card.tsx`
- Create: `packages/web/src/components/common/section.tsx`

- [ ] **Step 1: Create StatCard component**

Create `packages/web/src/components/common/stat-card.tsx`:

```tsx
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  icon?: string;
  status?: 'default' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
  delay?: number;
}

export function StatCard({ label, value, icon, status = 'default', onClick, delay = 0 }: StatCardProps) {
  const statusColors = {
    default: '',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };

  const Wrapper = onClick ? motion.button : motion.div;

  return (
    <Wrapper
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={cn(
        'stat-card glass-card rounded-2xl p-5 text-left',
        onClick && 'glass-card-hover cursor-pointer'
      )}
    >
      {icon && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg text-text-muted">{icon}</span>
          <span className="text-sm text-text-secondary font-medium">{label}</span>
        </div>
      )}
      {!icon && <p className="text-text-secondary text-sm mb-2">{label}</p>}
      <div className={cn('font-display text-2xl font-semibold tabular-nums', statusColors[status])}>
        {value}
      </div>
    </Wrapper>
  );
}
```

- [ ] **Step 2: Create Section component**

Create `packages/web/src/components/common/section.tsx`:

```tsx
import { cn } from '../../lib/utils';

interface SectionProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({ title, actions, children, className }: SectionProps) {
  return (
    <div className={cn('mb-8', className)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm uppercase tracking-wider text-text-secondary font-semibold">{title}</h3>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/common/
git commit -m "feat(web): add StatCard and Section components"
```

---

### Task 10: Create Chart Wrappers

**Files:**
- Create: `packages/web/src/components/charts/area-chart.tsx`
- Create: `packages/web/src/components/charts/pie-chart.tsx`

- [ ] **Step 1: Create AreaChart wrapper**

Create `packages/web/src/components/charts/area-chart.tsx`:

```tsx
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { colors } from '../../styles/theme';

interface DataPoint {
  [key: string]: string | number;
}

interface AreaChartProps {
  data: DataPoint[];
  xKey: string;
  yKey: string;
  color?: string;
  gradientId?: string;
  formatY?: (value: number) => string;
  formatTooltip?: (value: number) => string;
  height?: number;
}

export function AreaChart({
  data,
  xKey,
  yKey,
  color = colors.accent.DEFAULT,
  gradientId = 'areaGradient',
  formatY = (v) => `$${(v / 1000).toFixed(0)}k`,
  formatTooltip = (v) => `$${v.toLocaleString()}`,
  height = 256,
}: AreaChartProps) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey={xKey}
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatY}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value: number) => [formatTooltip(value), '']}
          />
          <Area
            type="monotone"
            dataKey={yKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Create PieChart wrapper**

Create `packages/web/src/components/charts/pie-chart.tsx`:

```tsx
import { PieChart as RechartsPieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { colors } from '../../styles/theme';

interface PieDataPoint {
  name: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieDataPoint[];
  innerRadius?: number;
  outerRadius?: number;
  size?: number;
}

export function DonutChart({
  data,
  innerRadius = 50,
  outerRadius = 80,
  size = 200,
}: PieChartProps) {
  return (
    <div style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsPieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
          />
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/charts/
git commit -m "feat(web): add AreaChart and DonutChart wrappers"
```

---

## Phase 4: Dashboard Page

### Task 11: Create New Dashboard Page

**Files:**
- Replace: `packages/web/src/pages/Dashboard.tsx`

**Substeps:**
1. Set up imports, mock data structures (todos, summaries)
2. Add greeting section with user name
3. Add plan summary cards grid
4. Add action items section with checkboxes
5. Add quick actions section

- [ ] **Step 1: Replace Dashboard with new design**

Replace `packages/web/src/pages/Dashboard.tsx`:

```tsx
import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';
import { StatCard } from '../components/common/stat-card';
import { Section } from '../components/common/section';
import { Button } from '../components/ui/button';

interface Todo {
  id: number;
  text: string;
  plan: string;
  planPath: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
}

// Mock data - will come from API
const mockTodos: Todo[] = [
  { id: 1, text: 'Review Roth conversion opportunity', plan: 'Tax Strategy', planPath: '/tax-strategy', priority: 'high', dueDate: 'Apr 15' },
  { id: 2, text: 'Increase 401k contribution', plan: 'Retirement', planPath: '/plans/retirement', priority: 'high', dueDate: 'Next paycheck' },
  { id: 3, text: 'Pay extra $200 on credit card', plan: 'Debt Payoff', planPath: '/plans/debt-payoff', priority: 'medium', dueDate: 'Mar 28' },
  { id: 4, text: 'Update tax withholdings', plan: 'Tax Strategy', planPath: '/tax-strategy', priority: 'low', dueDate: 'Apr 1' },
];

const mockSummaries = [
  { id: 'net-worth', icon: '◈', name: 'Net Worth', value: '+2.4%', label: 'this month', status: 'success' as const, path: '/net-worth' },
  { id: 'retirement', icon: '◎', name: 'Retirement', value: '73%', label: 'readiness', status: 'warning' as const, path: '/plans/retirement' },
  { id: 'tax-strategy', icon: '◇', name: 'Tax Strategy', value: '$12.1k', label: 'savings found', status: 'success' as const, path: '/tax-strategy' },
  { id: 'debt-payoff', icon: '◆', name: 'Debt Payoff', value: 'Aug 2029', label: 'debt-free date', status: 'success' as const, path: '/plans/debt-payoff' },
  { id: 'cash-flow', icon: '◉', name: 'Cash Flow', value: '34%', label: 'savings rate', status: 'success' as const, path: '/cash-flow' },
];

export function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [completedTodos, setCompletedTodos] = useState<number[]>([]);

  const toggleTodo = (id: number) => {
    setCompletedTodos((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const priorityColors = {
    high: 'bg-danger',
    medium: 'bg-warning',
    low: 'bg-accent',
  };

  const firstName = user?.email?.split('@')[0] || 'there';

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-10"
      >
        <p className="text-text-muted text-sm mb-1">Good morning,</p>
        <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight capitalize">
          {firstName}
        </h2>
      </motion.div>

      {/* Plan Summaries */}
      <Section title="Your Financial Plans">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
          {mockSummaries.map((summary, i) => (
            <StatCard
              key={summary.id}
              icon={summary.icon}
              label={summary.name}
              value={summary.value}
              status={summary.status}
              onClick={() => navigate(summary.path)}
              delay={i * 0.05}
            />
          ))}
        </div>
      </Section>

      {/* Action Items */}
      <Section title="Action Items">
        <div className="glass-card rounded-2xl divide-y divide-border overflow-hidden">
          {mockTodos.map((todo, i) => (
            <motion.div
              key={todo.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className={cn(
                'p-4 md:p-5 flex items-center gap-3 md:gap-4 transition-all duration-300 hover:bg-surface-hover',
                completedTodos.includes(todo.id) && 'opacity-40'
              )}
            >
              <button
                onClick={() => toggleTodo(todo.id)}
                className={cn(
                  'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 flex-shrink-0',
                  completedTodos.includes(todo.id)
                    ? 'bg-accent border-accent text-bg'
                    : 'border-border hover:border-accent/50'
                )}
              >
                {completedTodos.includes(todo.id) && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', priorityColors[todo.priority])} />

              <div className="flex-1 min-w-0">
                <div className={cn('text-sm font-medium', completedTodos.includes(todo.id) && 'line-through text-text-muted')}>
                  {todo.text}
                </div>
                <button
                  onClick={() => navigate(todo.planPath)}
                  className="text-sm text-text-muted hover:text-accent transition-colors"
                >
                  {todo.plan}
                </button>
              </div>

              <div className="text-sm text-text-muted font-medium flex-shrink-0">{todo.dueDate}</div>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <div className="flex flex-wrap gap-3">
          <Button>Sync All Accounts</Button>
          <Button variant="secondary">Run Full Analysis</Button>
          <Button variant="secondary">Export Reports</Button>
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Verify dashboard renders**

Run: `cd packages/web && pnpm dev`
Expected: New dashboard with summaries, todos, and quick actions

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Dashboard.tsx
git commit -m "feat(web): replace dashboard with new design"
```

---

## Phase 5: Net Worth Page

### Task 12: Create Net Worth Page

**Files:**
- Create: `packages/web/src/pages/net-worth.tsx`
- Modify: `packages/web/src/App.tsx`

**Substeps:**
1. Set up imports, interfaces, mock history data, color mapping
2. Add API fetch with useEffect and loading state
3. Add net worth over time chart section
4. Add asset allocation pie chart section
5. Add expandable account categories section

- [ ] **Step 1: Create NetWorth page**

Create `packages/web/src/pages/net-worth.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatMoney } from '../lib/utils';
import { Section } from '../components/common/section';
import { AreaChart } from '../components/charts/area-chart';
import { DonutChart } from '../components/charts/pie-chart';
import { api } from '../lib/api';

interface AccountCategory {
  category: string;
  value: number;
  color: string;
  accounts: Array<{
    name: string;
    balance: number;
    institution: string;
  }>;
}

// Mock data for net worth history - will come from API
const netWorthHistory = [
  { month: 'Oct', value: 485000 },
  { month: 'Nov', value: 492000 },
  { month: 'Dec', value: 501000 },
  { month: 'Jan', value: 498000 },
  { month: 'Feb', value: 510500 },
  { month: 'Mar', value: 523000 },
];

// Color mapping for account types
const typeColors: Record<string, string> = {
  depository: '#4ade80',
  investment: '#60a5fa',
  credit: '#f87171',
  loan: '#f87171',
};

export function NetWorth() {
  const [balances, setBalances] = useState<Array<{
    accountId: string;
    name: string;
    type: string;
    mask: string | null;
    balance: string | null;
    currency: string;
  }>>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBalances()
      .then((data) => {
        setBalances(data.balances);
        // Expand all by default
        const expanded: Record<string, boolean> = {};
        const types = new Set(data.balances.map((b) => b.type));
        types.forEach((t) => { expanded[t] = true; });
        setExpandedCategories(expanded);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  // Group accounts by type
  const categories: AccountCategory[] = Object.entries(
    balances.reduce<Record<string, { value: number; accounts: Array<{ name: string; balance: number; institution: string }> }>>(
      (acc, b) => {
        const type = b.type;
        if (!acc[type]) acc[type] = { value: 0, accounts: [] };
        const balance = parseFloat(b.balance || '0');
        acc[type].value += balance;
        acc[type].accounts.push({ name: b.name, balance, institution: 'Linked Account' });
        return acc;
      },
      {}
    )
  ).map(([category, data]) => ({
    category: category.charAt(0).toUpperCase() + category.slice(1),
    value: data.value,
    color: typeColors[category] || '#a8a29e',
    accounts: data.accounts,
  }));

  const totalNetWorth = categories.reduce((sum, c) => sum + c.value, 0);
  const assets = categories.filter((c) => c.value > 0);
  const totalAssets = assets.reduce((sum, c) => sum + c.value, 0);

  const pieData = assets.map((c) => ({
    name: c.category,
    value: c.value,
    color: c.color,
  }));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      {/* Net Worth Over Time */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-4 md:p-8 mb-6 md:mb-8"
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-4 md:mb-6 gap-4">
          <div>
            <p className="text-text-muted text-sm mb-2">Total Net Worth</p>
            <div className="font-display text-4xl md:text-5xl font-semibold tracking-tight tabular-nums">
              {formatMoney(totalNetWorth)}
            </div>
          </div>
          <div className="text-left md:text-right">
            <div className="text-xl md:text-2xl font-semibold tabular-nums text-success">
              +$12,500
            </div>
            <div className="text-sm text-text-muted mt-1">This month (+2.4%)</div>
          </div>
        </div>
        <AreaChart
          data={netWorthHistory}
          xKey="month"
          yKey="value"
          height={200}
        />
      </motion.div>

      {/* Asset Allocation */}
      {pieData.length > 0 && (
        <Section title="Asset Allocation">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-2xl p-4 md:p-6"
          >
            <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
              <DonutChart data={pieData} size={200} />
              <div className="flex-1 grid grid-cols-2 gap-3 md:gap-4 w-full">
                {assets.map((item) => (
                  <div key={item.category} className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.category}</div>
                      <div className="text-xs text-text-muted tabular-nums">
                        {((item.value / totalAssets) * 100).toFixed(1)}% · {formatMoney(item.value, true)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </Section>
      )}

      {/* Accounts */}
      <Section title="Accounts">
        <div className="space-y-3">
          {categories.map((category, i) => (
            <motion.div
              key={category.category}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className="glass-card rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => toggleCategory(category.category)}
                className="w-full p-4 md:p-5 text-left hover:bg-surface-hover transition-all duration-200"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="font-medium">{category.category}</span>
                    <span className="text-sm text-text-muted px-2 py-0.5 rounded-full bg-surface-solid">
                      {category.accounts.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={cn(
                        'font-display text-lg md:text-xl font-semibold tabular-nums',
                        category.value < 0 && 'text-danger'
                      )}
                    >
                      {formatMoney(category.value)}
                    </span>
                    <motion.span
                      animate={{ rotate: expandedCategories[category.category] ? 180 : 0 }}
                      className="text-text-muted"
                    >
                      ▾
                    </motion.span>
                  </div>
                </div>
              </button>

              <AnimatePresence>
                {expandedCategories[category.category] && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-border bg-bg/30 overflow-hidden"
                  >
                    {category.accounts.map((account, j) => (
                      <motion.div
                        key={j}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: j * 0.05 }}
                        className="px-4 md:px-5 py-3 md:py-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-center gap-3 md:gap-4 pl-4 md:pl-6">
                          <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-surface-solid flex items-center justify-center text-xs md:text-sm font-medium text-text-muted">
                            {account.institution.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-sm md:text-base">{account.name}</div>
                            <div className="text-xs md:text-sm text-text-muted">{account.institution}</div>
                          </div>
                        </div>
                        <span
                          className={cn(
                            'font-medium tabular-nums text-sm md:text-base',
                            account.balance < 0 && 'text-danger'
                          )}
                        >
                          {formatMoney(account.balance)}
                        </span>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx to use NetWorth page**

In `packages/web/src/App.tsx`, replace the placeholder route:

```tsx
// Add import at top
import { NetWorth } from './pages/net-worth';

// Replace the route
<Route path="/net-worth" component={NetWorth} />
```

- [ ] **Step 3: Verify page works**

Run: `cd packages/web && pnpm dev`
Navigate to /net-worth
Expected: Net worth page with chart, pie chart, and accounts

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/net-worth.tsx packages/web/src/App.tsx
git commit -m "feat(web): add net worth page with charts and accounts"
```

---

## Phase 6: Remaining Pages (Stubs)

### Task 13: Create Page Stubs for Remaining Views

**Files:**
- Create: `packages/web/src/pages/cash-flow.tsx`
- Create: `packages/web/src/pages/tax-strategy.tsx`
- Create: `packages/web/src/pages/retirement.tsx`
- Create: `packages/web/src/pages/savings-goal.tsx`
- Create: `packages/web/src/pages/debt-payoff.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Create CashFlow stub**

Create `packages/web/src/pages/cash-flow.tsx`:

```tsx
import { motion } from 'framer-motion';
import { Section } from '../components/common/section';
import { StatCard } from '../components/common/stat-card';

export function CashFlow() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Cash Flow</h1>
        <p className="text-text-muted mt-2">Income, expenses, and savings analysis</p>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        <StatCard label="Monthly Income" value="$12,500" delay={0} />
        <StatCard label="Monthly Expenses" value="$8,200" delay={0.05} />
        <StatCard label="Savings Rate" value="34%" status="success" delay={0.1} />
        <StatCard label="Emergency Runway" value="18 months" delay={0.15} />
      </div>

      <Section title="Expense Breakdown">
        <div className="glass-card rounded-2xl p-6 text-center text-text-muted">
          Expense visualization coming soon...
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Create TaxStrategy stub**

Create `packages/web/src/pages/tax-strategy.tsx`:

```tsx
import { motion } from 'framer-motion';
import { Section } from '../components/common/section';
import { StatCard } from '../components/common/stat-card';

export function TaxStrategy() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Tax Strategy</h1>
        <p className="text-text-muted mt-2">Tax optimization opportunities</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-8">
        <StatCard label="Marginal Bracket" value="24%" delay={0} />
        <StatCard label="Effective Rate" value="18.2%" delay={0.05} />
        <StatCard label="Potential Savings" value="$12,100" status="success" delay={0.1} />
      </div>

      <Section title="Tax Return Analysis">
        <div className="glass-card rounded-2xl p-12 text-center text-text-muted">
          PDF upload and analysis coming soon...
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 3: Create Retirement stub**

Create `packages/web/src/pages/retirement.tsx`:

```tsx
import { motion } from 'framer-motion';
import { Section } from '../components/common/section';
import { Progress } from '../components/ui/progress';

export function Retirement() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Retirement Plan</h1>
        <p className="text-text-muted mt-2">Track your retirement readiness</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-2xl p-6 md:p-8 mb-8"
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-text-muted text-sm mb-2">Retirement Readiness</p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-5xl md:text-6xl font-semibold text-accent tabular-nums">73</span>
              <span className="font-display text-xl md:text-2xl text-text-muted">%</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl md:text-3xl font-semibold tabular-nums">$1.2M</div>
            <div className="text-sm text-text-muted mt-1">Projected at 65</div>
          </div>
        </div>
        <Progress value={73} glow />
      </motion.div>

      <Section title="AI Recommendations">
        <div className="glass-card rounded-2xl p-6 text-center text-text-muted">
          AI-powered recommendations coming soon...
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 4: Create SavingsGoal stub**

Create `packages/web/src/pages/savings-goal.tsx`:

```tsx
import { useRoute } from 'wouter';
import { motion } from 'framer-motion';
import { Progress } from '../components/ui/progress';

export function SavingsGoal() {
  const [, params] = useRoute('/plans/savings/:id');
  const goalId = params?.id || 'unknown';

  // Mock data based on ID
  const goals: Record<string, { name: string; target: number; current: number; targetDate: string }> = {
    house: { name: 'House Down Payment', target: 80000, current: 36000, targetDate: 'Dec 2027' },
    vacation: { name: 'Europe Vacation', target: 8000, current: 5760, targetDate: 'Aug 2026' },
  };

  const goal = goals[goalId] || { name: 'Unknown Goal', target: 10000, current: 0, targetDate: 'TBD' };
  const progress = (goal.current / goal.target) * 100;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">{goal.name}</h1>
        <p className="text-text-muted mt-2">Target: {goal.targetDate}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-2xl p-6 md:p-8 mb-8"
      >
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="text-text-muted text-sm mb-2">Current Progress</p>
            <div className="font-display text-4xl md:text-5xl font-semibold tabular-nums">
              ${goal.current.toLocaleString()}
              <span className="text-xl md:text-2xl text-text-muted"> / ${goal.target.toLocaleString()}</span>
            </div>
          </div>
          <div className="text-lg md:text-xl font-semibold text-success">
            {progress.toFixed(0)}% complete
          </div>
        </div>
        <Progress value={progress} glow className="h-3" />
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 5: Create DebtPayoff stub**

Create `packages/web/src/pages/debt-payoff.tsx`:

```tsx
import { motion } from 'framer-motion';
import { Section } from '../components/common/section';
import { StatCard } from '../components/common/stat-card';

export function DebtPayoff() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Debt Payoff</h1>
        <p className="text-text-muted mt-2">Your debt elimination strategy</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-8">
        <StatCard label="Total Debt" value="$107k" status="danger" delay={0} />
        <StatCard label="Monthly Payment" value="$2,100" delay={0.05} />
        <StatCard label="Debt-Free Date" value="Aug 2029" status="success" delay={0.1} />
      </div>

      <Section title="Your Debts">
        <div className="glass-card rounded-2xl p-6 text-center text-text-muted">
          Debt list and payoff strategy coming soon...
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 6: Update App.tsx with all routes**

Replace `packages/web/src/App.tsx`:

```tsx
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
        <Route path="/tax-strategy" component={TaxStrategy} />
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
```

- [ ] **Step 7: Verify all routes work**

Run: `cd packages/web && pnpm dev`
Navigate to each route and verify they render
Expected: All pages render with stub content

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/ packages/web/src/App.tsx
git commit -m "feat(web): add stub pages for all routes"
```

---

## Verification & Cleanup

### Task 14: Final Verification

- [ ] **Step 1: Run type check**

```bash
cd packages/web && pnpm typecheck
```
Expected: No type errors

- [ ] **Step 2: Run the full app**

```bash
cd packages/web && pnpm dev
```
Expected: App runs, all pages navigate correctly, animations work

- [ ] **Step 3: Test mobile responsiveness**

Open dev tools, toggle device toolbar, test on mobile viewport
Expected: Sidebar collapses, hamburger menu works, pages are responsive

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add .
git commit -m "fix(web): address any final issues"
```

---

## Summary

This plan establishes the foundation for the Lasagna frontend redesign:

1. **Phase 1**: Foundation - Tailwind, design tokens, base UI components
2. **Phase 2**: Layout - Shell, sidebar, mobile navigation
3. **Phase 3**: Common components - StatCard, Section, charts
4. **Phase 4**: Dashboard - Full redesign with todos and summaries
5. **Phase 5**: Net Worth - Chart, pie chart, expandable accounts
6. **Phase 6**: Remaining pages - Stubs ready for full implementation

**Next iteration would add:**
- Full implementation of remaining pages (Cash Flow, Tax Strategy, etc.)
- API integration for real data
- Plan CRUD operations
- AI chat integration
- PDF export
