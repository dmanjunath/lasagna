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

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatFullCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

export function ScenarioExplorer({
  title,
  data,
  scenarios,
  sliders,
  onSliderChange,
}: ScenarioExplorerProps) {
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
    <div className="bg-surface/50 backdrop-blur-sm border border-border/50 rounded-2xl p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {selectedValue !== undefined && (
          <div className="text-right">
            <span className="text-xs text-text-secondary uppercase tracking-wide">At {selectedYear}</span>
            <p className="text-xl font-semibold text-text tabular-nums">{formatFullCurrency(selectedValue)}</p>
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
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="year"
              stroke="#57534e"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dy={8}
            />
            <YAxis
              stroke="#57534e"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCurrency}
              dx={-8}
              width={60}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(12, 10, 9, 0.95)',
                border: '1px solid #3f3f46',
                borderRadius: '12px',
                fontSize: '13px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                padding: '12px 16px',
              }}
              formatter={(value) => [formatFullCurrency(Number(value) || 0), activeScenarioConfig?.label]}
              labelStyle={{ color: '#f5f5f5', fontWeight: 600, marginBottom: 4 }}
              itemStyle={{ color: '#a8a29e' }}
              cursor={{ stroke: activeScenarioConfig?.color, strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey={activeScenario}
              stroke={activeScenarioConfig?.color || '#6366f1'}
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
