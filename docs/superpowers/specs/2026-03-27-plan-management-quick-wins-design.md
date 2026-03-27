# Plan Management Quick Wins

## Overview

A polish pass on plan creation and management UX. Cherry-picks the easiest high-impact improvements across 4 areas without deep architectural changes.

## Scope

| Area | Change |
|------|--------|
| Plan Creation | Skip name step, auto-generate from first prompt |
| Plan Organization | Delete buttons on plan cards and sidebar |
| Plan Actions | Inline rename on plan detail page |
| Onboarding | Plan type cards in empty state with tooltips |

## 1. Simplified Plan Creation

### Current Flow
1. Select plan type
2. Enter plan name
3. Click "Create Plan"

### New Flow
1. Select plan type → plan created immediately
2. Name auto-generates as "Untitled {Type} Plan"
3. After first chat message, name updates based on prompt content

### Auto-naming Logic

```typescript
// On plan creation:
title = `Untitled ${typeLabel} Plan`  // e.g., "Untitled Retirement Plan"

// After first chat response, extract title from user's question:
// "Can I retire at 55 with $2M?" → "Retire at 55 with $2M"
// "How much do I need to save monthly?" → "Monthly Savings Goal"
```

The API should return a suggested title in the v2 response, or the frontend can derive it from the first user message (first 50 chars, trimmed at word boundary).

### Files to Modify
- `packages/web/src/pages/plans/new.tsx` - Remove name input, navigate on type click
- `packages/api/src/routes/plans.ts` - Accept optional title, default to "Untitled {Type} Plan"
- `packages/web/src/components/chat/chat-panel.tsx` - Update plan title after first response

## 2. Delete in List View & Sidebar

### Plan Cards (`/plans` page)
- Add trash icon in top-right corner of each card
- Icon visible on hover only (opacity transition)
- Click triggers confirmation dialog: "Delete '{title}'? This will archive the plan."
- On confirm, call `api.deletePlan(id)` and remove from list

### Sidebar
- Add small ✕ button on right side of each plan item
- Visible on hover only
- Same confirmation flow as cards

### Files to Modify
- `packages/web/src/pages/plans/index.tsx` - Add delete button to plan cards
- `packages/web/src/components/layout/sidebar.tsx` - Add delete button to plan items

## 3. Inline Rename

### Interaction
1. **Default state**: Title displays normally, pencil icon appears on hover
2. **Click title**: Transforms to input field, text auto-selected
3. **Enter or blur**: Save changes, show brief ✓ checkmark (1s)
4. **Escape**: Cancel edit, revert to original title

### Implementation
- Create `EditableTitle` component with internal editing state
- On save, call `api.updatePlan(id, { title })`
- Optimistic update with rollback on error

### Files to Modify
- `packages/web/src/pages/plans/[id].tsx` - Replace static h1 with EditableTitle
- `packages/web/src/components/ui/editable-title.tsx` - New component
- `packages/api/src/routes/plans.ts` - Add PATCH endpoint for title update (if not exists)

## 4. Onboarding Empty State

### Current Empty State
- Shows file icon + "No plans yet" + single "Create Plan" button

### New Empty State
- Headline: "Create Your First Plan"
- Subtext: "Choose a plan type to get started with AI-powered financial guidance"
- 2x2 grid of plan type cards (same as /plans/new but inline)
- Each card has:
  - Icon (emoji)
  - Title
  - Info icon (ⓘ) with tooltip
  - Short description

### Tooltip Content
| Type | Tooltip |
|------|---------|
| Retirement | "Plan your retirement with Monte Carlo simulations, withdrawal strategies, and scenario analysis" |
| Net Worth | "Track your total wealth across all accounts, analyze trends, and optimize asset allocation" |
| Debt Payoff | "Create a strategy to pay off debt using avalanche or snowball methods, see payoff timelines" |
| Custom | "Create a custom plan for any financial goal - saving for a house, college fund, vacation, etc." |

### Click Behavior
- Clicking a card creates the plan immediately (no /plans/new redirect)
- Uses same simplified creation flow (no name input)

### Files to Modify
- `packages/web/src/pages/plans/index.tsx` - Replace empty state with plan type grid
- Consider extracting `PlanTypeCard` component for reuse

## Component Summary

### New Components
- `packages/web/src/components/ui/editable-title.tsx`

### Modified Components
- `packages/web/src/pages/plans/new.tsx`
- `packages/web/src/pages/plans/index.tsx`
- `packages/web/src/pages/plans/[id].tsx`
- `packages/web/src/components/layout/sidebar.tsx`
- `packages/api/src/routes/plans.ts`

## Out of Scope
- Plan folders/tags/grouping
- Search/filter
- Duplicate plan
- Export/share
- Context menus
- Plan comparison

These are deferred to a future phase.

## Success Criteria
1. Can create a plan in 1 click (just pick type)
2. Plan auto-names from first chat message
3. Can rename plan by clicking title
4. Can delete plans from list view and sidebar
5. New users see helpful plan type cards, not empty void
