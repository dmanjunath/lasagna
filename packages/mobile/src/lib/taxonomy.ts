import type { TaxonomyCategory, TaxonomyGroup } from "@web/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { SFSymbol } from "expo-symbols";
import { request } from "@/api/client";

// SF Symbols for the system categories, one per lucide icon in
// packages/web/src/lib/categories.tsx.
const SYMBOLS: Record<string, SFSymbol> = {
  income: "dollarsign",
  housing: "house",
  transportation: "car",
  food_dining: "fork.knife",
  groceries: "cart",
  utilities: "lightbulb",
  healthcare: "heart.text.square",
  insurance: "shield",
  entertainment: "film",
  shopping: "bag",
  personal_care: "scissors",
  education: "graduationcap",
  travel: "airplane",
  subscriptions: "tv",
  savings_investment: "chart.line.uptrend.xyaxis",
  debt_payment: "creditcard",
  gifts_donations: "gift",
  taxes: "building.columns",
  transfer: "arrow.left.arrow.right",
  other: "receipt",
  car_payment: "creditcard",
  gas: "fuelpump",
  parking_tolls: "parkingsign",
  auto_maintenance: "wrench.adjustable",
  home_improvement: "hammer",
  internet_phone: "wifi",
  coffee_shops: "cup.and.saucer",
  clothing: "tshirt",
  electronics: "desktopcomputer",
  fitness: "dumbbell",
  bank_fees: "building.columns",
  software_saas: "macwindow",
};

export type CategoryDisplay = { label: string; symbol: SFSymbol; emoji: string | null };

export function useTaxonomy() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => request<{ groups: TaxonomyGroup[] }>("/categories"),
    staleTime: 5 * 60_000,
  });
}

export function displayFor(cat: Pick<TaxonomyCategory, "name" | "systemKey" | "emoji"> | undefined): CategoryDisplay {
  if (!cat) return { label: "Other", symbol: "receipt", emoji: null };
  const symbol = (cat.systemKey && SYMBOLS[cat.systemKey]) || "receipt";
  return { label: cat.name, symbol, emoji: cat.systemKey ? null : cat.emoji };
}

export function useCategoryDisplay(): (categoryId: string | null | undefined) => CategoryDisplay {
  const { data } = useTaxonomy();
  const byId = useMemo(() => {
    const m = new Map<string, TaxonomyCategory>();
    for (const g of data?.groups ?? []) for (const c of g.categories) m.set(c.id, c);
    return m;
  }, [data]);
  return useCallback((id) => displayFor(id ? byId.get(id) : undefined), [byId]);
}
