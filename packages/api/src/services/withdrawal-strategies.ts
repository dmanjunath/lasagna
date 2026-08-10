// packages/api/src/services/withdrawal-strategies.ts

export type StrategyType = "constant_dollar" | "percent_of_portfolio" | "guardrails" | "rules_based";

export interface StrategyParams {
  // constant_dollar
  inflationAdjusted?: boolean;

  // percent_of_portfolio
  withdrawalRate?: number;
  floor?: number | null;
  ceiling?: number | null;

  // guardrails
  initialRate?: number;
  capitalPreservationThreshold?: number;
  prosperityThreshold?: number;
  increaseAmount?: number;
  decreaseAmount?: number;

  // rules_based
  marketDownThreshold?: number;
  depletionOrder?: string[];
}

export interface WithdrawalContext {
  currentBalance: number;
  initialBalance: number;
  year: number;
  annualWithdrawal: number;
  cumulativeInflation: number;
  yearInflationRate: number;
  equityReturn: number;
  currentAllocation: Record<string, number>;
  previousWithdrawal?: number;
}

export interface WithdrawalResult {
  amount: number;
  source?: string;
  notes: string[];
  allocationAfterWithdrawal?: Record<string, number>;
}

export function computeWithdrawal(
  strategy: StrategyType,
  params: StrategyParams,
  ctx: WithdrawalContext
): WithdrawalResult {
  switch (strategy) {
    case "constant_dollar":
      return constantDollar(params, ctx);
    case "percent_of_portfolio":
      return percentOfPortfolio(params, ctx);
    case "guardrails":
      return guardrails(params, ctx);
    case "rules_based":
      return rulesBased(params, ctx);
  }
}

function constantDollar(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const inflationAdjusted = params.inflationAdjusted !== false;
  const amount = inflationAdjusted
    ? ctx.annualWithdrawal * ctx.cumulativeInflation
    : ctx.annualWithdrawal;

  return {
    amount: Math.min(amount, ctx.currentBalance),
    notes: inflationAdjusted && ctx.year > 1
      ? [`Inflation-adjusted: $${Math.round(amount).toLocaleString()}`]
      : [],
  };
}

function percentOfPortfolio(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const rate = (params.withdrawalRate ?? 4) / 100;
  let amount = ctx.currentBalance * rate;
  const notes: string[] = [];

  if (params.floor != null) {
    const adjustedFloor = params.floor * ctx.cumulativeInflation;
    if (amount < adjustedFloor) {
      amount = adjustedFloor;
      notes.push(`Floor applied: $${Math.round(adjustedFloor).toLocaleString()}`);
    }
  }

  if (params.ceiling != null) {
    const adjustedCeiling = params.ceiling * ctx.cumulativeInflation;
    if (amount > adjustedCeiling) {
      amount = adjustedCeiling;
      notes.push(`Ceiling applied: $${Math.round(adjustedCeiling).toLocaleString()}`);
    }
  }

  return { amount: Math.min(amount, ctx.currentBalance), notes };
}

function guardrails(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const initialRate = (params.initialRate ?? 5) / 100;
  const cpThreshold = (params.capitalPreservationThreshold ?? 20) / 100;
  const prosThreshold = (params.prosperityThreshold ?? 20) / 100;
  const increaseAmt = (params.increaseAmount ?? 10) / 100;
  const decreaseAmt = (params.decreaseAmount ?? 10) / 100;
  const notes: string[] = [];

  let baseWithdrawal = ctx.previousWithdrawal
    ? ctx.previousWithdrawal * (1 + ctx.yearInflationRate)
    : ctx.initialBalance * initialRate;

  const effectiveRate = baseWithdrawal / ctx.currentBalance;

  if (effectiveRate > initialRate * (1 + cpThreshold)) {
    baseWithdrawal *= (1 - decreaseAmt);
    notes.push(`Capital preservation: cut withdrawal ${(decreaseAmt * 100).toFixed(0)}%`);
  } else if (effectiveRate < initialRate * (1 - prosThreshold)) {
    baseWithdrawal *= (1 + increaseAmt);
    notes.push(`Prosperity rule: raised withdrawal ${(increaseAmt * 100).toFixed(0)}%`);
  }

  return { amount: Math.min(baseWithdrawal, ctx.currentBalance), notes };
}

function rulesBased(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const threshold = (params.marketDownThreshold ?? -10) / 100;
  const depletionOrder = params.depletionOrder ?? ["cash", "bonds", "reits", "intlStocks", "usStocks"];
  const notes: string[] = [];

  const amount = Math.min(ctx.annualWithdrawal * ctx.cumulativeInflation, ctx.currentBalance);
  const allocation = { ...ctx.currentAllocation };

  let source: string;

  if (ctx.equityReturn < threshold) {
    source = withdrawByDepletionOrder(amount, allocation, depletionOrder);
    notes.push(`Market down ${(ctx.equityReturn * 100).toFixed(1)}%: ${source}`);
  } else {
    source = "proportional from all assets";
    withdrawProportionally(amount, allocation);
  }

  return { amount, source, notes, allocationAfterWithdrawal: allocation };
}

function withdrawByDepletionOrder(
  amount: number,
  allocation: Record<string, number>,
  order: string[]
): string {
  let remaining = amount;
  const sources: string[] = [];

  for (const assetClass of order) {
    if (remaining <= 0) break;
    const available = allocation[assetClass] || 0;
    if (available <= 0) continue;

    const take = Math.min(remaining, available);
    allocation[assetClass] = available - take;
    remaining -= take;
    sources.push(assetClass);
  }

  if (remaining > 0) {
    for (const key of Object.keys(allocation)) {
      if (remaining <= 0) break;
      const available = allocation[key] || 0;
      if (available <= 0) continue;
      const take = Math.min(remaining, available);
      allocation[key] = available - take;
      remaining -= take;
    }
  }

  return sources.length > 0 ? `withdrew from ${sources.join(", ")}` : "no assets available";
}

function withdrawProportionally(amount: number, allocation: Record<string, number>): void {
  const total = Object.values(allocation).reduce((s, v) => s + v, 0);
  if (total <= 0) return;
  for (const key of Object.keys(allocation)) {
    allocation[key] -= (allocation[key] / total) * amount;
  }
}
