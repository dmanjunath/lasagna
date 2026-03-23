# Lasagna Design Audit

A comprehensive UX/UI review with actionable feedback to elevate the design.

---

## Executive Summary

The app has a solid dark theme foundation with warm amber accents. The new logo animation is polished. However, several pages feel incomplete or lack visual hierarchy. The design language is consistent but safe—there are opportunities to add more character and delight.

**Overall Score: 7/10**

---

## Global Issues

### Typography
- **Font pairing is good** (Fraunces display + DM Sans body) but underutilized
- Fraunces is only used for headings—consider using it for large stat values to add more character
- Body text sizes feel uniform; more variation in scale would create better hierarchy

### Color
- Amber accent is strong but used sparingly
- Success green (#4ade80) is too saturated against the dark bg—consider a more muted tone
- The muted text color (#a8a29e) is borderline too low contrast for accessibility

### Motion
- Staggered fade-in animations are nice but predictable
- No micro-interactions on hover states for cards
- Missing loading states and skeleton screens

### Spacing
- Consistent padding but feels cramped on mobile (p-4)
- Section spacing is tight—pages feel dense

---

## Page-by-Page Feedback

### 1. Login Page

**What's Working:**
- Clean centered card with subtle ambient glow
- Logo animation is delightful
- Good form field styling

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| Generic tagline "Personal finance platform" | Make it compelling: "Your AI-powered path to financial freedom" |
| No visual interest in background | Add subtle animated gradient mesh or floating shapes |
| Form fields are plain rectangles | Add icons (envelope, lock) inside inputs for better affordance |
| No password visibility toggle | Add show/hide password button |
| "Sign up" link is small and easy to miss | Make the auth mode toggle more prominent with a pill/tab design |
| No social login options | Consider adding Google/Apple sign-in buttons (even as placeholders) |

**Design Opportunity:** The login is the first impression—add a side panel with a compelling value proposition, testimonials, or animated data visualization to sell the product.

---

### 2. Dashboard (Overview)

**What's Working:**
- Good greeting personalization
- Clear stat cards with color-coded status
- Action items list is functional

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| Username shows ugly email prefix "E2e-Test-1774220183110" | Parse and format properly, or prompt users to set a display name |
| "Good morning" is static | Make it dynamic based on time of day |
| Stat cards are visually identical | Differentiate the "hero" metric (Net Worth) with larger size or different treatment |
| No sparklines or trend indicators | Add mini charts in stat cards to show direction |
| Action items lack visual priority distinction | Use colored left borders or background tints for priority levels |
| "Quick Actions" section feels like an afterthought | Either make it prominent with iconography or remove it |
| No data visualization | Add a small chart showing weekly/monthly progress |
| Empty state not visible | "No plans yet" state in sidebar feels disconnected |

**Design Opportunity:** Dashboard should feel like a command center. Add a "Financial Health Score" hero metric, progress rings, or a weekly snapshot chart.

---

### 3. Net Worth Page

**What's Working:**
- Large hero number ($80,060) commands attention
- Chart is clean with good color coding
- Asset allocation donut is readable

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| "+$12,500" change indicator is small and far from the main number | Place it directly next to or below the hero value |
| Chart Y-axis labels are tiny and hard to read | Increase font size, use proper number formatting ($450K not $450k) |
| Chart has no interactive tooltips visible | Add hover states showing exact values |
| Asset allocation donut is isolated | Add the actual dollar amounts next to percentages |
| Only two asset categories shown | Show more granular breakdown (stocks, bonds, real estate, crypto, etc.) |
| No accounts list visible | Add a section showing linked accounts contributing to net worth |
| Page feels sparse below the fold | Add historical comparison, milestones, or projections |

**Design Opportunity:** Make this page feel like a wealth tracker. Add milestone markers ("You crossed $80K!"), year-over-year comparison, and net worth projections.

---

### 4. Cash Flow Page

**What's Working:**
- Clear income/expenses/savings breakdown
- Stat cards are well organized

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| "Expense visualization coming soon..." is a dead end | Show a placeholder with sample data or a more engaging "under construction" state |
| No visual representation of cash flow | Add a Sankey diagram or waterfall chart |
| Monthly values without context | Add comparison to previous month or average |
| "Emergency Runway: 18 months" has no visual indicator | Add a progress bar or gauge |
| Savings Rate (34%) should feel more celebratory | Add a progress ring or comparison to recommended rate |
| No transaction list or categorization | Users expect to see where money is going |

**Design Opportunity:** Cash flow is the most actionable metric. Show a daily/weekly spending burn-down, category breakdown with icons, and AI insights ("You spent 20% more on dining this month").

---

### 5. Tax Strategy Page

**What's Working:**
- Clean layout
- Good stat organization

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| "PDF upload and analysis coming soon..." is another dead end | At minimum, show a drag-and-drop zone with instructions |
| "Potential Savings: $12,100" is the hero but doesn't feel like one | Make this HUGE and celebratory—it's the value prop |
| Marginal Bracket (24%) needs context | Show where the user falls on a tax bracket visualization |
| No actionable items visible | List specific tax optimization strategies |
| Page is mostly empty | Add tax calendar, deduction checklist, or estimated quarterly payment reminders |

**Design Opportunity:** Tax is scary for most people. Add a "Tax Health" score, show specific strategies with potential savings for each, and provide a year-end checklist.

---

### 6. AI Plans Page (Empty State)

**What's Working:**
- Clean empty state
- Clear CTA

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| Generic document icon | Use a more compelling illustration or animation |
| "No plans yet" is uninspiring | Reframe as opportunity: "Ready to build your financial future?" |
| Single CTA button | Show preview cards of what types of plans are possible |
| No social proof or examples | Add "See example plans" or showcase templates |
| Redundant "New Plan" button in header AND empty state | Keep one, make it prominent |

**Design Opportunity:** This is where the AI magic happens—sell it! Show animated examples of AI-generated insights, plan previews, or a "What can Lasagna help with?" carousel.

---

### 7. Create a Plan Page

**What's Working:**
- Clear plan type options
- Good iconography
- Descriptions explain each type

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| Plan cards don't have hover states visible | Add elevation or border glow on hover |
| Icons are small and mono-colored | Make icons larger, add accent color or gradients |
| No visual hierarchy between options | If one plan type is recommended, highlight it |
| Selecting a plan type isn't obvious | Add radio buttons or checkmarks to show selection state |
| "Custom" plan seems like an afterthought | Either make it prominent as the AI-powered option, or explain the difference |
| No preview of what happens next | Show "Step 1 of 3" or preview the next screen |

**Design Opportunity:** Add preview illustrations for each plan type showing what the output looks like. Use AI to pre-recommend a plan based on user data.

---

### 8. Sidebar Navigation

**What's Working:**
- Logo animation is great
- Clear section organization
- Active state is visible

**Improvements:**
| Issue | Recommendation |
|-------|----------------|
| Icons are Unicode symbols (◐ ◈ ◉) | Use custom SVG icons for a more polished look |
| "YOUR PLANS" section label is all-caps and harsh | Use sentence case or smaller size |
| "No plans yet" feels sad | Use encouraging copy: "Create your first plan" |
| "+ New Plan" button is dashed border style | Make it more prominent, possibly with accent color |
| User profile section at bottom is cramped | Add more breathing room, show actual user name |
| "DM" initials are hardcoded | Generate from actual user name/email |
| "Pro Plan" badge could be more premium | Add a subtle shine or badge treatment |

---

## Plan Detail Page & Chat Panel

**Critical Layout Issues:**

| Issue | Location | Problem |
|-------|----------|---------|
| Chat panel height inheritance | `[id].tsx:116-127` | The `motion.div` wrapper doesn't set explicit height; relies on `h-full` in ChatPanel but parent has `overflow-hidden` without height |
| Empty chat message no padding | `message-list.tsx:14` | The empty state "Start a conversation..." has no padding, text touches edges |
| Plan empty state no padding | `[id].tsx:103-105` | "Start a conversation to generate content" is raw text in a `<p>` with no spacing |
| Sidebar height | `sidebar.tsx` | Uses `h-full` but relies on parent context; can cause overflow issues on smaller screens |

**Specific Fixes Needed:**

1. **Chat panel container** - Add explicit height to the motion.div wrapper:
   ```tsx
   <motion.div className="border-l border-border overflow-hidden h-full">
   ```

2. **Empty message state** - Add padding to the message-list empty state:
   ```tsx
   <div className="flex-1 flex items-center justify-center text-text-muted p-6 text-center">
   ```

3. **Plan empty content** - Add padding/styling to the fallback message:
   ```tsx
   <p className="text-text-muted text-center py-8">
   ```

**Other Chat/Plan Issues:**

| Issue | Recommendation |
|-------|----------------|
| Chat header just says "Chat" | Add context: "Chat with Lasagna AI" or show plan name |
| No typing indicator | Add animated dots when AI is responding |
| Input placeholder is generic | Make it contextual to plan type |
| Starter prompts disappear after selection | Should remain visible or show in chat history |
| No message timestamps | Add relative time ("2 min ago") to messages |
| Chat panel has no resize handle | Allow users to resize the panel width |
| No chat history indicator | Show how many messages in thread |

---

## Component-Level Feedback

### Stat Cards
- Need more visual differentiation for different value types
- Consider adding trend arrows (↑↓) next to values
- Icon + label header takes up too much space

### Glass Cards
- The glassmorphism effect is subtle—could be more pronounced
- Border gradient is nice but barely visible
- Missing inner shadow for depth

### Buttons
- Primary button (amber) is good
- Secondary buttons need more visible hover states
- Consider adding subtle hover animations

### Form Inputs
- Lack icons for context
- Focus states could be more prominent
- No error states visible

---

## Accessibility Concerns

1. **Color contrast**: Muted text (#a8a29e on #0c0a09) may fail WCAG AA
2. **Focus indicators**: Not clearly visible on many interactive elements
3. **Touch targets**: Some buttons/links are small on mobile
4. **Screen reader**: Unicode icons (◈ ◉ ◇) may not announce properly

---

## Detailed Code-Level Issues

### Component Issues

**button.tsx**
- Line 13: `ghost` variant missing background color base
- Line 15: `danger` variant uses hardcoded opacity (`/10`, `/30`) instead of theme tokens

**mobile-nav.tsx**
- Line 50: Fixed `top-4 left-4` doesn't account for mobile safe areas/notches
- Line 52: Hamburger uses emoji `☰` instead of Lucide icons like other components

**section.tsx**
- Line 12: Hardcoded `mb-8` margin - not responsive
- Line 14: Title is `text-sm` - very small, inconsistent with page heading hierarchy

**chart-block.tsx**
- Line 14: `DONUT_COLORS` hardcoded array - not using design system
- Lines 64-70: Bar chart uses hardcoded colors (`#a8a29e`, `#1c1917`, `#fbbf24`) - NOT using theme
- Line 73: Bar radius `[4, 4, 0, 0]` hardcoded - inconsistent with `rounded-xl` elsewhere

**message-list.tsx**
- Line 14: Empty state has no minimum height - cramped in small containers
- Line 14: Empty state text has no padding

**sidebar.tsx**
- Line 52: Fixed `w-64` - no responsive behavior for tablets
- Line 117: Loading shows plain "Loading..." - no spinner (inconsistent with ToolStatus)
- Line 119: "No plans yet" differs from PlansPage empty state message

**starter-prompts.tsx**
- Line 60: Prompt buttons have no focus state - accessibility issue
- Line 72: Input focus uses `focus:border-accent/50` but no visible ring
- Line 77: Send button uses `bg-accent` but Button component uses gradient

**chat-panel.tsx**
- Line 117: Uses `h-full` but parent in [id].tsx doesn't set height
- Line 138: Input missing `focus:ring` - only border change, accessibility issue

**stat-card.tsx**
- Lines 36-39: Icon spacing `mb-3` but no margin when icon absent - spacing inconsistency

### Page Issues

**Dashboard.tsx**
- Line 71: Grid jumps `grid-cols-2 md:grid-cols-5` - no sm: breakpoint
- Line 88: `divide-y` creates unnecessary bottom border on last item

**Accounts.tsx**
- Lines 86-95: Uses non-Tailwind CSS classes (`"dashboard"`, `"header"`) - completely disconnected from design system

**net-worth.tsx**
- Line 146: Donut chart `size={200}` hardcoded - not responsive
- Line 228: Account row padding misaligned - outer `px-4 md:px-5` vs inner `pl-4 md:pl-6`

**cash-flow.tsx / tax-strategy.tsx**
- Line 25/24: Empty state just shows "coming soon..." text - no proper empty state component
- Line 17: Grid jumps columns without sm: breakpoint

**plans/new.tsx**
- Lines 72-76: No focus state for keyboard navigation - only hover state
- Line 72: Uses inline conditionals instead of `cn()` utility

**plans/index.tsx**
- Line 28: Uses `p-6` - doesn't use responsive `p-4 md:p-8` like other pages

**plans/[id].tsx**
- Line 74: Magic number `h-[calc(100vh-4rem)]` - assumes header height
- Line 76: `p-6` not responsive - other pages use `p-4 md:p-8`
- Line 139: Chat panel width hardcoded `width: 400` - not responsive

**Login.tsx**
- Lines 37-38: Ambient glow colors hardcoded, not from theme
- Line 69: Input focus ring `focus:ring-1 focus:ring-accent/20` - inconsistent with Button's `focus-visible:ring-2`
- Line 108: Inline SVG spinner instead of Lucide icon

---

## Cross-Codebase Consistency Issues

### 1. Hardcoded Colors (15 instances)
Components using raw hex values instead of theme:
- `chart-block.tsx`: Bar chart colors
- `Logo.tsx`: Gradient colors
- `Login.tsx`: Ambient glow
- `area-chart.tsx` / `pie-chart.tsx`: Tooltip styling

### 2. Missing Responsive Breakpoints
- **All page headings**: `text-2xl md:text-3xl` (missing `lg:`)
- **All number displays**: `text-4xl md:text-5xl` (missing `lg:`)
- **Multiple grids**: Missing `sm:` breakpoint between xs and md

### 3. Inconsistent Empty States
| Page | Pattern |
|------|---------|
| PlansPage | Icon + heading + text + button (good) |
| CashFlow | Plain text in card |
| TaxStrategy | Plain text, different padding |
| Retirement | Just text, no structure |
| MessageList | Centered text, no padding |

### 4. Focus State Inconsistencies
| Component | Focus Style |
|-----------|-------------|
| Button | `focus-visible:ring-2 focus-visible:ring-accent/50` |
| Login inputs | `focus:ring-1 focus:ring-accent/20` |
| Starter prompts | Only border change |
| Plan type buttons | None |

### 5. Padding/Spacing Inconsistencies
| Component | Padding |
|-----------|---------|
| StatCard | `p-5` |
| ChatPanel sections | `p-4` |
| Card component | `p-6` |
| Message bubbles | `px-4 py-3` |
| Plan cards | `p-6` |

### 6. Loading State Inconsistencies
| Location | Implementation |
|----------|----------------|
| Sidebar | Text "Loading..." (no spinner) |
| PlanDetail | Spinner + text |
| Login button | Inline SVG spinner |
| ToolStatus | Lucide Loader2 |
| ChatPanel | Lucide Loader2 |

### 7. Border Radius Inconsistencies
- Cards: `rounded-2xl` (16px)
- Inputs: `rounded-xl` (12px)
- Tooltips: Hardcoded `12px`
- Bar charts: `[4, 4, 0, 0]` (4px)

### 8. Animation Gaps
**Animated:**
- StatCard, plan items, page headings, logo

**Not animated:**
- Progress bars, table rows, empty states, error messages

---

## Quick Wins (Low Effort, High Impact)

1. **Fix chat panel height** - Add `h-full` to motion.div wrapper
2. **Add padding to empty states** - Chat message list and plan empty content need `p-6`
3. **Dynamic greeting** based on time of day
4. **Add sparklines** to stat cards
5. **Replace Unicode icons** with SVGs
6. **Add loading skeletons** for better perceived performance
7. **Improve empty states** with illustrations and better copy
8. **Add hover micro-interactions** on cards
9. **Standardize focus states** - Use `focus-visible:ring-2` consistently
10. **Fix Accounts.tsx** - Refactor to use Tailwind/design system

1. **Fix chat panel height** - Add `h-full` to motion.div wrapper
2. **Add padding to empty states** - Chat message list and plan empty content need `p-6`
3. **Dynamic greeting** based on time of day
4. **Add sparklines** to stat cards
5. **Replace Unicode icons** with SVGs
6. **Add loading skeletons** for better perceived performance
7. **Improve empty states** with illustrations and better copy
8. **Add hover micro-interactions** on cards

---

## Bigger Opportunities

1. **Onboarding flow** - Guide new users through account linking and first plan
2. **Data visualization upgrade** - Replace "coming soon" with real charts
3. **AI personality** - Give the AI advisor a name/avatar for chat interactions
4. **Gamification** - Add milestones, streaks, achievements
5. **Mobile optimization** - Current mobile experience feels like compressed desktop

---

## Recommended Priority

### Phase 1 (Polish)
- Fix contrast/accessibility issues
- Add loading states and skeletons
- Improve empty states
- Dynamic greeting

### Phase 2 (Delight)
- Add micro-interactions
- Sparklines in stat cards
- Better iconography
- Hover animations

### Phase 3 (Differentiation)
- Data visualizations (charts, progress rings)
- Onboarding flow
- AI personality/branding
- Gamification elements

---

*Audit completed: March 2026*
*Screenshots captured via Playwright*
