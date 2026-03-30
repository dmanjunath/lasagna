import { cn } from "../../lib/utils";

type StrategyType =
  | "constant_dollar"
  | "percent_of_portfolio"
  | "guardrails"
  | "rules_based";

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
  { value: "rules_based", label: "Rules-Based" },
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
      <div className="flex justify-between text-xs text-text-muted">
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
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
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
        <p className="text-xs text-text-muted">
          ${(monthlySpend * 12).toLocaleString()}/yr
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

      <p className="text-xs text-text-muted mt-1">
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

function RulesBasedControls({
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
  const threshold = params.marketDownThreshold ?? -10;

  return (
    <div className="space-y-5">
      {/* Monthly spend */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-text-secondary">Monthly Spending</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
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
        <p className="text-xs text-text-muted">${(monthlySpend * 12).toLocaleString()}/yr, adjusted for inflation</p>
      </div>

      {/* Decision rules as a visual flowchart */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-text-secondary">Withdrawal Rules</label>

        <div className="rounded-xl border border-border overflow-hidden">
          {/* Rule 1: Down market */}
          <div className="p-3 bg-danger/5 border-b border-border">
            <div className="flex items-start gap-3">
              <span className="text-xs font-semibold text-danger bg-danger/10 rounded px-1.5 py-0.5 mt-0.5 flex-shrink-0">IF</span>
              <div className="flex-1">
                <p className="text-sm text-text">
                  Equities drop more than <strong className="text-danger">{threshold}%</strong> in a year
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-warning bg-warning/10 rounded px-1.5 py-0.5">THEN</span>
                  <p className="text-xs text-text-secondary">Withdraw from safe assets first:</p>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5 ml-12">
                  {["Cash", "Bonds", "REITs"].map((item, i) => (
                    <span key={item} className="flex items-center gap-1">
                      <span className="bg-surface-solid rounded border border-border px-2 py-0.5 text-xs font-medium text-text">{item}</span>
                      {i < 2 && <span className="text-text-muted text-xs">&rarr;</span>}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-1.5 ml-12">If safe assets run out, remainder comes from equities.</p>
              </div>
            </div>
          </div>

          {/* Rule 2: Flat/up market */}
          <div className="p-3 bg-success/5">
            <div className="flex items-start gap-3">
              <span className="text-xs font-semibold text-success bg-success/10 rounded px-1.5 py-0.5 mt-0.5 flex-shrink-0">ELSE</span>
              <div className="flex-1">
                <p className="text-sm text-text">
                  Market is flat or up
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-semibold text-accent bg-accent/10 rounded px-1.5 py-0.5">THEN</span>
                  <p className="text-xs text-text-secondary">Withdraw proportionally from all asset classes</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Threshold slider */}
      <SliderField
        label="Market drop threshold"
        value={threshold}
        min={-30}
        max={-5}
        step={5}
        format={(v) => `${v}%`}
        minLabel="-30%"
        maxLabel="-5%"
        onChange={(v) => onParamsChange({ ...params, marketDownThreshold: v })}
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
        {strategy === "rules_based" && (
          <RulesBasedControls
            params={params}
            monthlySpend={monthlySpend}
            onMonthlySpendChange={onMonthlySpendChange}
            onParamsChange={onParamsChange}
          />
        )}
      </div>
    </div>
  );
}

export type { StrategyType, StrategyParams, StrategyConfigProps };
