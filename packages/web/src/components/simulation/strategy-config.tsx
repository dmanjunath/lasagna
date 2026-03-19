import { cn, formatMoney } from "../../lib/utils";

type StrategyType =
  | "constant_dollar"
  | "percent_of_portfolio"
  | "guardrails";

interface StrategyParams {
  inflationAdjusted?: boolean;
  withdrawalRate?: number;
  floor?: number | null;
  ceiling?: number | null;
  initialRate?: number;
  capitalPreservationThreshold?: number;
  prosperityThreshold?: number;
  increaseAmount?: number;
  decreaseAmount?: number;
  marketDownThreshold?: number;
  depletionOrder?: string[];
}

interface StrategyConfigProps {
  strategy: StrategyType;
  params: StrategyParams;
  annualSpending: number;
  monthlySpend: number;
  onMonthlySpendChange: (v: number) => void;
  onStrategyChange: (s: StrategyType) => void;
  onParamsChange: (p: StrategyParams) => void;
}

const STRATEGY_TABS: { value: StrategyType; label: string }[] = [
  { value: "constant_dollar", label: "Constant Dollar" },
  { value: "percent_of_portfolio", label: "% of Portfolio" },
  { value: "guardrails", label: "Guardrails" },
];

const DEFAULT_DEPLETION_ORDER = [
  "Cash",
  "Bonds",
  "REITs",
  "Int'l Stocks",
  "US Stocks",
];

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  minLabel,
  maxLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  minLabel: string;
  maxLabel: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-secondary">
          {label}
        </label>
        <span className="text-sm font-semibold tabular-nums">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent"
      />
      <div className="flex justify-between text-xs text-text-secondary">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function ConstantDollarControls({
  params,
  monthlySpend,
  onMonthlySpendChange,
  onParamsChange,
}: {
  params: StrategyParams;
  monthlySpend: number;
  onMonthlySpendChange: (v: number) => void;
  onParamsChange: (p: StrategyParams) => void;
}) {
  const inflationAdjusted = params.inflationAdjusted ?? true;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-text-secondary">
          Monthly Spending
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
          <input
            type="number"
            value={monthlySpend}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 0) onMonthlySpendChange(v);
            }}
            min={0}
            max={100000}
            className="w-full bg-surface rounded-xl border border-border pl-8 pr-4 py-3 text-text tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <p className="text-xs text-text-secondary">
          {formatMoney(monthlySpend * 12, true)}/yr
          {inflationAdjusted ? ", adjusted for inflation each year" : ""}
        </p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={inflationAdjusted}
          onChange={(e) =>
            onParamsChange({ ...params, inflationAdjusted: e.target.checked })
          }
          className="accent-accent w-4 h-4 rounded"
        />
        <span className="text-sm font-medium text-text-secondary">
          Adjust for inflation
        </span>
      </label>
    </div>
  );
}

function PercentOfPortfolioControls({
  params,
  onParamsChange,
}: {
  params: StrategyParams;
  onParamsChange: (p: StrategyParams) => void;
}) {
  const rate = params.withdrawalRate ?? 4;

  return (
    <div className="space-y-5">
      <SliderField
        label="Withdrawal rate"
        value={rate}
        min={1}
        max={10}
        step={0.5}
        format={(v) => `${v}%`}
        minLabel="1%"
        maxLabel="10%"
        onChange={(v) => onParamsChange({ ...params, withdrawalRate: v })}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium text-text-secondary">
          Floor (optional)
        </label>
        <input
          type="number"
          placeholder="Minimum annual withdrawal"
          value={params.floor ?? ""}
          onChange={(e) =>
            onParamsChange({
              ...params,
              floor: e.target.value ? parseFloat(e.target.value) : null,
            })
          }
          className="w-full bg-surface rounded-xl border border-border px-4 py-3 text-text"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-text-secondary">
          Ceiling (optional)
        </label>
        <input
          type="number"
          placeholder="Maximum annual withdrawal"
          value={params.ceiling ?? ""}
          onChange={(e) =>
            onParamsChange({
              ...params,
              ceiling: e.target.value ? parseFloat(e.target.value) : null,
            })
          }
          className="w-full bg-surface rounded-xl border border-border px-4 py-3 text-text"
        />
      </div>

      <p className="text-xs text-text-secondary mt-1">
        Withdraw {rate}% of your portfolio each year.
      </p>
    </div>
  );
}

function GuardrailsControls({
  params,
  onParamsChange,
}: {
  params: StrategyParams;
  onParamsChange: (p: StrategyParams) => void;
}) {
  return (
    <div className="space-y-5">
      <SliderField
        label="Initial withdrawal rate"
        value={params.initialRate ?? 5}
        min={3}
        max={8}
        step={0.5}
        format={(v) => `${v}%`}
        minLabel="3%"
        maxLabel="8%"
        onChange={(v) => onParamsChange({ ...params, initialRate: v })}
      />
      <SliderField
        label="Capital preservation threshold"
        value={params.capitalPreservationThreshold ?? 20}
        min={10}
        max={50}
        step={5}
        format={(v) => `${v}%`}
        minLabel="10%"
        maxLabel="50%"
        onChange={(v) =>
          onParamsChange({ ...params, capitalPreservationThreshold: v })
        }
      />
      <SliderField
        label="Prosperity threshold"
        value={params.prosperityThreshold ?? 20}
        min={10}
        max={50}
        step={5}
        format={(v) => `${v}%`}
        minLabel="10%"
        maxLabel="50%"
        onChange={(v) =>
          onParamsChange({ ...params, prosperityThreshold: v })
        }
      />
      <SliderField
        label="Decrease amount"
        value={params.decreaseAmount ?? 10}
        min={5}
        max={25}
        step={5}
        format={(v) => `${v}%`}
        minLabel="5%"
        maxLabel="25%"
        onChange={(v) => onParamsChange({ ...params, decreaseAmount: v })}
      />
      <SliderField
        label="Increase amount"
        value={params.increaseAmount ?? 10}
        min={5}
        max={25}
        step={5}
        format={(v) => `${v}%`}
        minLabel="5%"
        maxLabel="25%"
        onChange={(v) => onParamsChange({ ...params, increaseAmount: v })}
      />
    </div>
  );
}

export function StrategyConfig({
  strategy,
  params,
  annualSpending,
  monthlySpend,
  onMonthlySpendChange,
  onStrategyChange,
  onParamsChange,
}: StrategyConfigProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {STRATEGY_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onStrategyChange(tab.value)}
            className={cn(
              "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
              strategy === tab.value
                ? "bg-accent/10 text-accent border-accent/30"
                : "border-border text-text-secondary hover:text-text hover:border-accent/20"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {strategy === "constant_dollar" && (
          <ConstantDollarControls
            params={params}
            monthlySpend={monthlySpend}
            onMonthlySpendChange={onMonthlySpendChange}
            onParamsChange={onParamsChange}
          />
        )}
        {strategy === "percent_of_portfolio" && (
          <PercentOfPortfolioControls
            params={params}
            onParamsChange={onParamsChange}
          />
        )}
        {strategy === "guardrails" && (
          <GuardrailsControls
            params={params}
            onParamsChange={onParamsChange}
          />
        )}
      </div>
    </div>
  );
}

export type { StrategyType, StrategyParams, StrategyConfigProps };
