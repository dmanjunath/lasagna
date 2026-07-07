import React from 'react';
import {
  DollarSign,
  Home,
  Car,
  UtensilsCrossed,
  ShoppingCart,
  Lightbulb,
  HeartPulse,
  Shield,
  Clapperboard,
  ShoppingBag,
  Scissors,
  GraduationCap,
  Plane,
  Tv,
  TrendingUp,
  CreditCard,
  Gift,
  Landmark,
  ArrowLeftRight,
  Receipt,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Category config — label + Bright lucide glyph. Slice/legend color is assigned
// at render time from the --ui-viz-* palette so the donut never reads as one
// blob and light/dark swap automatically.
// ---------------------------------------------------------------------------

export const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  income:             { label: 'Income',              icon: <DollarSign size={15} /> },
  housing:            { label: 'Housing',             icon: <Home size={15} /> },
  transportation:     { label: 'Transportation',      icon: <Car size={15} /> },
  food_dining:        { label: 'Dining Out',          icon: <UtensilsCrossed size={15} /> },
  groceries:          { label: 'Groceries',           icon: <ShoppingCart size={15} /> },
  utilities:          { label: 'Utilities',           icon: <Lightbulb size={15} /> },
  healthcare:         { label: 'Healthcare',          icon: <HeartPulse size={15} /> },
  insurance:          { label: 'Insurance',           icon: <Shield size={15} /> },
  entertainment:      { label: 'Entertainment',       icon: <Clapperboard size={15} /> },
  shopping:           { label: 'Shopping',            icon: <ShoppingBag size={15} /> },
  personal_care:      { label: 'Personal Care',       icon: <Scissors size={15} /> },
  education:          { label: 'Education',           icon: <GraduationCap size={15} /> },
  travel:             { label: 'Travel',              icon: <Plane size={15} /> },
  subscriptions:      { label: 'Subscriptions',       icon: <Tv size={15} /> },
  savings_investment: { label: 'Savings & Investment', icon: <TrendingUp size={15} /> },
  debt_payment:       { label: 'Debt Payment',        icon: <CreditCard size={15} /> },
  gifts_donations:    { label: 'Gifts & Donations',   icon: <Gift size={15} /> },
  taxes:              { label: 'Taxes',               icon: <Landmark size={15} /> },
  transfer:           { label: 'Transfers',           icon: <ArrowLeftRight size={15} /> },
  other:              { label: 'Other',               icon: <Receipt size={15} /> },
};

export function getCategoryDisplay(key: string) {
  return CATEGORY_CONFIG[key] ?? { label: key, icon: <Receipt size={15} /> };
}
