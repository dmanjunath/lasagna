import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ChartControls } from './chart-controls.js';
import { TimelineScrubber } from './timeline-scrubber.js';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../../lib/hide-amounts.js';

interface ScenarioData {
  year: number;
  base?: number;
  bull?: number;
  bear?: number;
  [key: string]: number | undefined;
}

interface ScenarioExplorerProps {
  title: string;
  data: ScenarioData[];
  scenarios: { id: string; label: string; color: string }[];
  sliders?: {
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
    format?: 'percent' | 'currency' | 'number';
  }[];
  onSliderChange?: (values: Record<string, number>) => void;
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

export function ScenarioExplorer({
  title,
  data,
  scenarios,
  sliders,
  onSliderChange,
}: ScenarioExplorerProps) {
  const hideAmounts = isAmountsHidden();
  const [activeScenario, setActiveScenario] = useState(scenarios[0]?.id || 'base');
  const [sliderValues, setSliderValues] = useState<Record<string, number>>(
    sliders?.reduce((acc, s) => ({ ...acc, [s.id]: s.default }), {}) || {}
  );
  const [selectedYear, setSelectedYear] = useState(data[Math.floor(data.length / 2)]?.year || 2040);

  const years = useMemo(() => ({
    start: data[0]?.year || 2024,
    end: data[data.length - 1]?.year || 2060,
  }), [data]);

  const handleSliderChange = (id: string, value: number) => {
    const newValues = { ...sliderValues, [id]: value };
    setSliderValues(newValues);
    onSliderChange?.(newValues);
  };

  const selectedData = data.find(d => d.year === selectedYear);
  const selectedValue = selectedData?.[activeScenario];

  const activeScenarioConfig = scenarios.find(s => s.id === activeScenario);

  return (
    <div className="bg-panel border border-line rounded-ui-xl p-5 shadow-ui-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-content">{title}</h3>
        {selectedValue !== undefined && (
          <div className="text-right">
            <span className="text-xs text-content-secondary uppercase tracking-wide">At {selectedYear}</span>
            <p className="text-xl font-semibold text-content tabular-nums">{formatFullCurrency(selectedValue)}</p>
          </div>
        )}
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {scenarios.map((scenario) => (
                <linearGradient key={scenario.id} id={`gradient-${scenario.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={scenario.color} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={scenario.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-line)" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="year"
              stroke="rgb(var(--ui-content-muted))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dy={8}
            />
            {/* Money tick labels are removed while amounts are hidden, and the
                60px they reserved with them. The curve is unchanged: the domain
                is fit to the data. */}
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
            {/* The tooltip's only row is the scenario's dollar value, so with
                amounts hidden it would read as one bare mask. The row is
                dropped and the year label is what remains. */}
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgb(var(--ui-panel-raised))',
                border: '1px solid var(--ui-line)',
                borderRadius: '12px',
                fontSize: '13px',
                boxShadow: 'var(--ui-shadow-md)',
                padding: '12px 16px',
              }}
              formatter={(value) => [formatFullCurrency(Number(value) || 0), activeScenarioConfig?.label]}
              labelStyle={{ color: 'rgb(var(--ui-content))', fontWeight: 600, marginBottom: hideAmounts ? 0 : 4 }}
              itemStyle={hideAmounts ? { display: 'none' } : { color: 'rgb(var(--ui-content-secondary))' }}
              cursor={{ stroke: activeScenarioConfig?.color, strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey={activeScenario}
              stroke={activeScenarioConfig?.color || 'var(--ui-viz-2)'}
              strokeWidth={2.5}
              fill={`url(#gradient-${activeScenario})`}
              animationDuration={500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <TimelineScrubber
        startYear={years.start}
        endYear={years.end}
        currentYear={selectedYear}
        onChange={setSelectedYear}
      />

      <ChartControls
        scenarios={scenarios}
        activeScenario={activeScenario}
        onScenarioChange={setActiveScenario}
        sliders={sliders?.map(s => ({ ...s, value: sliderValues[s.id] || s.default }))}
        onSliderChange={handleSliderChange}
      />
    </div>
  );
}
