import { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { TimelineScrubber } from './timeline-scrubber.js';
import { cn } from '../../../lib/utils.js';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../../lib/hide-amounts.js';

interface AssetCategory {
  id: string;
  label: string;
  color: string;
}

interface YearData {
  year: number;
  total: number;
  [key: string]: number;
}

interface WealthProjectionProps {
  title: string;
  data: YearData[];
  categories: AssetCategory[];
  scenarios?: { id: string; label: string }[];
  currentAge?: number;
  retirementAge?: number;
}

const formatCurrency = (value: number): string => {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  if (value < 0) return `\u2212${formatCurrency(-value)}`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatFullCurrency = (value: number) => {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value).replace(/^-/, '\u2212');
};

// Custom tooltip component
function CustomTooltip({
  active,
  payload,
  label,
  categories,
}: {
  active?: boolean;
  payload?: any[];
  label?: number;
  categories: AssetCategory[];
}) {
  if (!active || !payload || payload.length === 0) return null;

  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);

  return (
    <div className="bg-panel-raised border border-line rounded-ui-lg p-4 shadow-ui-md min-w-[200px]">
      <div className="text-content font-semibold mb-3 pb-2 border-b border-line">
        Year {label}
      </div>
      <div className="space-y-2">
        {payload.reverse().map((entry, i) => {
          const category = categories.find((c) => c.id === entry.dataKey);
          const percentage = total > 0 ? ((entry.value / total) * 100).toFixed(1) : 0;
          return (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: entry.fill }}
                />
                <span className="text-[13px] text-content-secondary">
                  {category?.label || entry.dataKey}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[13px] text-content font-medium tabular-nums">
                  {formatFullCurrency(entry.value)}
                </span>
                <span className="text-[11px] text-content-secondary ml-2">
                  ({percentage}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-2 border-t border-line flex justify-between">
        <span className="text-[13px] text-content-secondary">Total</span>
        <span className="text-[15px] text-[rgb(var(--ui-brand-ink))] font-semibold tabular-nums">
          {formatFullCurrency(total)}
        </span>
      </div>
    </div>
  );
}

export function WealthProjection({
  title,
  data,
  categories,
  scenarios,
  currentAge = 30,
  retirementAge = 65,
}: WealthProjectionProps) {
  const [activeScenario, setActiveScenario] = useState(scenarios?.[0]?.id || 'base');
  const [selectedYear, setSelectedYear] = useState(
    data[Math.floor(data.length / 2)]?.year || 2040
  );
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const hideAmounts = isAmountsHidden();

  const years = useMemo(
    () => ({
      start: data[0]?.year || 2024,
      end: data[data.length - 1]?.year || 2060,
    }),
    [data]
  );

  const selectedData = data.find((d) => d.year === (hoveredYear || selectedYear));
  const displayYear = hoveredYear || selectedYear;

  // Calculate retirement year marker
  const retirementYear = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return currentYear + (retirementAge - currentAge);
  }, [currentAge, retirementAge]);

  return (
    <div className="bg-panel border border-line rounded-ui-xl shadow-ui-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-line">
        <h3 className="text-base font-semibold text-content">{title}</h3>
        {scenarios && scenarios.length > 1 && (
          <div className="flex gap-1">
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                onClick={() => setActiveScenario(scenario.id)}
                className={cn(
                  'px-3 py-1 rounded-lg text-[12px] font-medium transition-all',
                  activeScenario === scenario.id
                    ? 'bg-brand text-brand-fg'
                    : 'bg-panel text-content-secondary hover:bg-canvas-sunken'
                )}
              >
                {scenario.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex">
        {/* Chart area */}
        <div className="flex-1 p-5">
          {/* Year summary above chart */}
          {selectedData && (
            <div className="mb-4 flex items-baseline gap-3">
              <span className="text-content-secondary text-sm">
                At age {currentAge + (displayYear - years.start)}
              </span>
              <span className="text-2xl font-semibold text-content tabular-nums">
                {formatFullCurrency(selectedData.total)}
              </span>
            </div>
          )}

          {/* Stacked bar chart */}
          <div className="h-[300px] w-full">
            <ResponsiveContainer>
              <BarChart
                data={data}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                onMouseMove={(state: any) => {
                  if (state?.activePayload?.[0]) {
                    setHoveredYear(state.activePayload[0].payload.year);
                  }
                }}
                onMouseLeave={() => setHoveredYear(null)}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--ui-line)"
                  strokeOpacity={0.5}
                  vertical={false}
                />
                <XAxis
                  dataKey="year"
                  stroke="rgb(var(--ui-content-muted))"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                />
                {/* The money tick labels are removed while amounts are hidden,
                    not replaced by a column of identical masks, and the 60px
                    they reserved collapses with them. The bars are unchanged:
                    the domain is fit to the data, so the drawn heights are
                    already magnitude-free. */}
                <YAxis
                  stroke="rgb(var(--ui-content-muted))"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatCurrency}
                  dx={-8}
                  width={60}
                  hide={hideAmounts}
                />
                <Tooltip
                  content={<CustomTooltip categories={categories} />}
                  cursor={{ fill: 'var(--ui-hairline)' }}
                />
                {/* Retirement age reference line */}
                {retirementYear >= years.start && retirementYear <= years.end && (
                  <ReferenceLine
                    x={retirementYear}
                    stroke="var(--ui-viz-3)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: 'Retirement',
                      position: 'top',
                      fill: 'var(--ui-viz-3)',
                      fontSize: 11,
                    }}
                  />
                )}
                {/* Stacked bars */}
                {categories.map((category) => (
                  <Bar
                    key={category.id}
                    dataKey={category.id}
                    stackId="stack"
                    fill={category.color}
                    radius={[0, 0, 0, 0]}
                  >
                    {data.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={category.color}
                        fillOpacity={
                          hoveredYear === entry.year || (!hoveredYear && selectedYear === entry.year)
                            ? 1
                            : 0.8
                        }
                      />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Timeline scrubber */}
          <div className="mt-4">
            <TimelineScrubber
              startYear={years.start}
              endYear={years.end}
              currentYear={selectedYear}
              onChange={setSelectedYear}
            />
          </div>
        </div>

        {/* Legend sidebar */}
        <div className="w-48 border-l border-line p-5 bg-panel-inset">
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-4">
            Asset Allocation
          </div>
          <div className="space-y-3">
            {categories.map((category) => {
              const value = selectedData?.[category.id] || 0;
              const total = selectedData?.total || 1;
              const percentage = ((value / total) * 100).toFixed(1);

              return (
                <div key={category.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="text-[13px] text-content">{category.label}</span>
                  </div>
                  <div className="flex items-baseline gap-2 pl-5">
                    <span className="text-sm font-semibold text-content tabular-nums">
                      {formatCurrency(value)}
                    </span>
                    <span className="text-[11px] text-content-secondary">({percentage}%)</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total */}
          <div className="mt-6 pt-4 border-t border-line">
            <div className="text-xs text-content-secondary uppercase tracking-wide mb-2">
              Net Worth
            </div>
            <div className="text-lg font-semibold text-[rgb(var(--ui-brand-ink))] tabular-nums">
              {formatFullCurrency(selectedData?.total || 0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
