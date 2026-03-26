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
  return `$${value}`;
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="response-heading-2">{title}</h3>
        {selectedValue !== undefined && (
          <div className="text-right">
            <span className="response-label">At {selectedYear}</span>
            <p className="response-metric-small">{formatCurrency(selectedValue)}</p>
          </div>
        )}
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {scenarios.map((scenario) => (
                <linearGradient key={scenario.id} id={`gradient-${scenario.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={scenario.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={scenario.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="year"
              stroke="#6b6b6b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#6b6b6b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCurrency}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '8px',
                fontSize: '13px',
              }}
              formatter={(value) => [formatCurrency(Number(value) || 0), activeScenarioConfig?.label]}
              labelStyle={{ color: '#6b6b6b' }}
            />
            <Area
              type="monotone"
              dataKey={activeScenario}
              stroke={activeScenarioConfig?.color || '#6366f1'}
              strokeWidth={2}
              fill={`url(#gradient-${activeScenario})`}
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
