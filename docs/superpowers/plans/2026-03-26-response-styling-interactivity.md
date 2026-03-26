# Response Styling & Interactivity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform verbose, static chat responses into concise, interactive experiences with clean editorial styling and premium fintech interactivity.

**Architecture:** Enhance v2 response system with new directive types, interactive chart components, and typography design tokens. Update prompt to enforce conciseness.

**Tech Stack:** React, Tailwind CSS, Recharts, Framer Motion, TypeScript

---

## Task 1: Typography Design Tokens

**Files:**
- Create: `packages/web/src/components/plan-response/styles/tokens.css`
- Modify: `packages/web/tailwind.config.ts`

- [ ] **Step 1: Create design tokens CSS file**

```css
/* packages/web/src/components/plan-response/styles/tokens.css */
@layer components {
  .response-text {
    @apply text-[15px] leading-[1.7] text-[#a3a3a3];
  }

  .response-heading-1 {
    @apply text-[24px] font-semibold leading-[1.3] text-[#f5f5f5];
  }

  .response-heading-2 {
    @apply text-[18px] font-semibold leading-[1.4] text-[#f5f5f5];
  }

  .response-heading-3 {
    @apply text-[14px] font-medium leading-[1.4] text-[#f5f5f5];
  }

  .response-label {
    @apply text-[11px] font-medium uppercase tracking-wider text-[#6b6b6b];
  }

  .response-metric {
    @apply text-[28px] font-semibold leading-[1.2] text-[#f5f5f5];
  }

  .response-metric-small {
    @apply text-[20px] font-semibold leading-[1.2] text-[#f5f5f5];
  }
}
```

- [ ] **Step 2: Import tokens in main CSS**

Add import to `packages/web/src/index.css`:
```css
@import './components/plan-response/styles/tokens.css';
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/plan-response/styles/tokens.css packages/web/src/index.css
git commit -m "feat: add typography design tokens for response styling"
```

---

## Task 2: Expand Button Primitive

**Files:**
- Create: `packages/web/src/components/plan-response/primitives/expand-button.tsx`

- [ ] **Step 1: Create expand button component**

```tsx
// packages/web/src/components/plan-response/primitives/expand-button.tsx
import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

interface ExpandButtonProps {
  expanded: boolean;
  onToggle: () => void;
  label?: string;
}

export function ExpandButton({ expanded, onToggle, label }: ExpandButtonProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 text-[13px] text-accent hover:text-accent/80 transition-colors"
    >
      <span>{expanded ? (label ? 'Hide' : 'Less') : (label || 'Show more')}</span>
      <ChevronDown
        className={cn(
          'w-3.5 h-3.5 transition-transform duration-200',
          expanded && 'rotate-180'
        )}
      />
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/primitives/expand-button.tsx
git commit -m "feat: add expand button primitive"
```

---

## Task 3: Metric Pill Primitive

**Files:**
- Create: `packages/web/src/components/plan-response/primitives/metric-pill.tsx`

- [ ] **Step 1: Create metric pill component**

```tsx
// packages/web/src/components/plan-response/primitives/metric-pill.tsx
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

interface MetricPillProps {
  value: string;
  context?: string;
}

export function MetricPill({ value, context }: MetricPillProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="relative inline-flex group">
      <button
        onClick={handleCopy}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md',
          'bg-accent/10 text-accent font-semibold text-[15px]',
          'hover:bg-accent/20 transition-colors cursor-pointer'
        )}
      >
        {value}
        {copied ? (
          <Check className="w-3 h-3" />
        ) : (
          <Copy className="w-3 h-3 opacity-0 group-hover:opacity-50" />
        )}
      </button>
      {context && (
        <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 text-xs bg-surface-elevated text-text-muted rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          {context}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/primitives/metric-pill.tsx
git commit -m "feat: add metric pill primitive with copy and tooltip"
```

---

## Task 4: Insight Card Component

**Files:**
- Create: `packages/web/src/components/plan-response/cards/insight-card.tsx`

- [ ] **Step 1: Create insight card component**

```tsx
// packages/web/src/components/plan-response/cards/insight-card.tsx
import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ExpandButton } from '../primitives/expand-button.js';
import { cn } from '../../../lib/utils.js';

interface InsightCardProps {
  headline: string;
  details?: string;
  variant?: 'default' | 'warning' | 'success';
}

const variantStyles = {
  default: {
    border: 'border-accent/20',
    bg: 'bg-accent/5',
    icon: 'text-accent',
    label: 'text-accent',
  },
  warning: {
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/5',
    icon: 'text-amber-500',
    label: 'text-amber-500',
  },
  success: {
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/5',
    icon: 'text-emerald-500',
    label: 'text-emerald-500',
  },
};

export function InsightCard({ headline, details, variant = 'default' }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const styles = variantStyles[variant];

  return (
    <div className={cn('rounded-xl border p-4', styles.border, styles.bg)}>
      <div className="flex items-start gap-3">
        <Lightbulb className={cn('w-4 h-4 mt-0.5 flex-shrink-0', styles.icon)} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-[#f5f5f5] leading-relaxed">{headline}</p>

          {details && (
            <>
              <div className="mt-3">
                <ExpandButton
                  expanded={expanded}
                  onToggle={() => setExpanded(!expanded)}
                  label="analysis"
                />
              </div>

              {expanded && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="response-text prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{details}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/cards/insight-card.tsx
git commit -m "feat: add insight card with progressive disclosure"
```

---

## Task 5: Action Card Component

**Files:**
- Create: `packages/web/src/components/plan-response/cards/action-card.tsx`

- [ ] **Step 1: Create action card component**

```tsx
// packages/web/src/components/plan-response/cards/action-card.tsx
import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/utils.js';

interface ActionCardProps {
  action: string;
  context?: string;
  priority?: 'high' | 'medium' | 'low';
  onClick?: () => void;
}

const priorityStyles = {
  high: 'border-accent/30 bg-accent/5',
  medium: 'border-border bg-surface/50',
  low: 'border-border/50 bg-transparent',
};

export function ActionCard({ action, context, priority = 'medium', onClick }: ActionCardProps) {
  const [completed, setCompleted] = useState(false);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      setCompleted(!completed);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full text-left rounded-xl border p-4 transition-all duration-200',
        'hover:border-accent/50 hover:bg-accent/5',
        priorityStyles[priority],
        completed && 'opacity-50'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5',
          completed ? 'bg-accent border-accent' : 'border-border'
        )}>
          {completed ? (
            <Check className="w-3 h-3 text-white" />
          ) : (
            <ArrowRight className="w-3 h-3 text-accent" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-[15px] text-[#f5f5f5]',
            completed && 'line-through'
          )}>
            {action}
          </p>
          {context && (
            <p className="text-[13px] text-[#6b6b6b] mt-1">{context}</p>
          )}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/cards/action-card.tsx
git commit -m "feat: add action card with completion state"
```

---

## Task 6: Comparison Card Component

**Files:**
- Create: `packages/web/src/components/plan-response/cards/comparison-card.tsx`

- [ ] **Step 1: Create comparison card component**

```tsx
// packages/web/src/components/plan-response/cards/comparison-card.tsx
import { Check, X } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

interface ComparisonOption {
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  metric?: { label: string; value: string };
}

interface ComparisonCardProps {
  options: ComparisonOption[];
  onSelect?: (index: number) => void;
  selectedIndex?: number;
}

export function ComparisonCard({ options, onSelect, selectedIndex }: ComparisonCardProps) {
  return (
    <div className={cn(
      'grid gap-4',
      options.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
    )}>
      {options.map((option, i) => (
        <button
          key={i}
          onClick={() => onSelect?.(i)}
          className={cn(
            'text-left rounded-xl border p-5 transition-all duration-200',
            selectedIndex === i
              ? 'border-accent bg-accent/10'
              : 'border-border hover:border-accent/50 bg-surface/30'
          )}
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-[16px] font-semibold text-[#f5f5f5]">{option.title}</h4>
              <p className="text-[13px] text-[#6b6b6b] mt-1">{option.summary}</p>
            </div>

            <div className="space-y-2">
              {option.pros.map((pro, j) => (
                <div key={`pro-${j}`} className="flex items-start gap-2 text-[13px]">
                  <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[#a3a3a3]">{pro}</span>
                </div>
              ))}
              {option.cons.map((con, j) => (
                <div key={`con-${j}`} className="flex items-start gap-2 text-[13px]">
                  <X className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[#a3a3a3]">{con}</span>
                </div>
              ))}
            </div>

            {option.metric && (
              <div className="pt-3 border-t border-white/5">
                <span className="response-label">{option.metric.label}</span>
                <p className="response-metric-small mt-1">{option.metric.value}</p>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/cards/comparison-card.tsx
git commit -m "feat: add comparison card for side-by-side options"
```

---

## Task 7: Chart Controls Component

**Files:**
- Create: `packages/web/src/components/plan-response/charts/chart-controls.tsx`

- [ ] **Step 1: Create chart controls component**

```tsx
// packages/web/src/components/plan-response/charts/chart-controls.tsx
import { cn } from '../../../lib/utils.js';

interface SliderConfig {
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: 'percent' | 'currency' | 'number';
}

interface ScenarioConfig {
  id: string;
  label: string;
}

interface ChartControlsProps {
  scenarios?: ScenarioConfig[];
  activeScenario?: string;
  onScenarioChange?: (id: string) => void;
  sliders?: SliderConfig[];
  onSliderChange?: (id: string, value: number) => void;
}

function formatValue(value: number, format?: string): string {
  switch (format) {
    case 'percent':
      return `${value}%`;
    case 'currency':
      return `$${value.toLocaleString()}`;
    default:
      return value.toString();
  }
}

export function ChartControls({
  scenarios,
  activeScenario,
  onScenarioChange,
  sliders,
  onSliderChange,
}: ChartControlsProps) {
  return (
    <div className="space-y-4 p-4 bg-surface/50 rounded-xl border border-border/50">
      {/* Scenario toggles */}
      {scenarios && scenarios.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              onClick={() => onScenarioChange?.(scenario.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all',
                activeScenario === scenario.id
                  ? 'bg-accent text-white'
                  : 'bg-surface text-[#a3a3a3] hover:bg-surface-elevated'
              )}
            >
              {scenario.label}
            </button>
          ))}
        </div>
      )}

      {/* Sliders */}
      {sliders && sliders.length > 0 && (
        <div className="space-y-3">
          {sliders.map((slider) => (
            <div key={slider.id} className="space-y-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="text-[#6b6b6b]">{slider.label}</span>
                <span className="text-[#f5f5f5] font-medium">
                  {formatValue(slider.value, slider.format)}
                </span>
              </div>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step || 1}
                value={slider.value}
                onChange={(e) => onSliderChange?.(slider.id, Number(e.target.value))}
                className="w-full h-1.5 bg-border rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-accent
                  [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:transition-transform
                  [&::-webkit-slider-thumb]:hover:scale-110"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/charts/chart-controls.tsx
git commit -m "feat: add chart controls with scenario toggles and sliders"
```

---

## Task 8: Timeline Scrubber Component

**Files:**
- Create: `packages/web/src/components/plan-response/charts/timeline-scrubber.tsx`

- [ ] **Step 1: Create timeline scrubber component**

```tsx
// packages/web/src/components/plan-response/charts/timeline-scrubber.tsx
import { useCallback, useRef, useState } from 'react';
import { cn } from '../../../lib/utils.js';

interface TimelineScrubberProps {
  startYear: number;
  endYear: number;
  currentYear: number;
  onChange: (year: number) => void;
}

export function TimelineScrubber({
  startYear,
  endYear,
  currentYear,
  onChange,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const calculateYear = useCallback((clientX: number) => {
    if (!trackRef.current) return currentYear;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(startYear + percent * (endYear - startYear));
  }, [startYear, endYear, currentYear]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    onChange(calculateYear(e.clientX));
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      onChange(calculateYear(e.clientX));
    }
  }, [isDragging, calculateYear, onChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Attach global listeners when dragging
  useState(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  });

  const progress = ((currentYear - startYear) / (endYear - startYear)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[11px] text-[#6b6b6b] uppercase tracking-wider">
        <span>{startYear}</span>
        <span className="text-accent font-medium">{currentYear}</span>
        <span>{endYear}</span>
      </div>
      <div
        ref={trackRef}
        onMouseDown={handleMouseDown}
        className="relative h-2 bg-border rounded-full cursor-pointer"
      >
        <div
          className="absolute left-0 top-0 h-full bg-accent/30 rounded-full"
          style={{ width: `${progress}%` }}
        />
        <div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-accent rounded-full',
            'shadow-lg shadow-accent/20 transition-transform',
            isDragging ? 'scale-125' : 'hover:scale-110'
          )}
          style={{ left: `calc(${progress}% - 8px)` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/charts/timeline-scrubber.tsx
git commit -m "feat: add timeline scrubber for year selection"
```

---

## Task 9: Scenario Explorer Component

**Files:**
- Create: `packages/web/src/components/plan-response/charts/scenario-explorer.tsx`

- [ ] **Step 1: Create scenario explorer component**

```tsx
// packages/web/src/components/plan-response/charts/scenario-explorer.tsx
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
              formatter={(value: number) => [formatCurrency(value), activeScenarioConfig?.label]}
              labelStyle={{ color: '#6b6b6b' }}
            />
            <Area
              type="monotone"
              dataKey={activeScenario}
              stroke={activeScenarioConfig?.color || '#6366f1'}
              strokeWidth={2}
              fill={`url(#gradient-${activeScenario})`}
            />
            {/* Reference line for selected year */}
            {selectedYear && (
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#6366f1"
                strokeOpacity={0.5}
                horizontal={false}
                vertical={true}
              />
            )}
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/charts/scenario-explorer.tsx
git commit -m "feat: add scenario explorer with interactive controls"
```

---

## Task 10: Update Directive Parser

**Files:**
- Modify: `packages/web/src/lib/directive-parser.ts`

- [ ] **Step 1: Extend directive parser for new types**

Add parsing for `::insight`, `::comparison`, `::action`, `::scenario-explorer` directives. Parse YAML content for config blocks, split on `---` for insight headline/details.

- [ ] **Step 2: Add tests for new directive parsing**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/directive-parser.ts
git commit -m "feat: extend directive parser for insight, comparison, action, scenario-explorer"
```

---

## Task 11: Update Markdown Renderer

**Files:**
- Modify: `packages/web/src/components/plan-response/markdown-renderer.tsx`

- [ ] **Step 1: Import new card and chart components**

- [ ] **Step 2: Add cases for new directive types in switch statement**

- [ ] **Step 3: Update prose styling to use new design tokens**

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/plan-response/markdown-renderer.tsx
git commit -m "feat: integrate new directive components in markdown renderer"
```

---

## Task 12: Update V2 System Prompt

**Files:**
- Modify: `packages/api/src/agent/prompt-v2.ts`

- [ ] **Step 1: Rewrite prompt for conciseness**

Replace verbose prompt with tight, rule-based guidance:
- Lead with the answer
- One insight per block
- Numbers over words
- Progressive disclosure
- Query-type → structure mapping

- [ ] **Step 2: Add directive syntax examples**

Document `::insight`, `::comparison`, `::action`, `::scenario-explorer` with examples.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/agent/prompt-v2.ts
git commit -m "feat: rewrite v2 prompt for concise, structured responses"
```

---

## Task 13: Create Index Exports

**Files:**
- Create: `packages/web/src/components/plan-response/primitives/index.ts`
- Create: `packages/web/src/components/plan-response/cards/index.ts`
- Create: `packages/web/src/components/plan-response/charts/index.ts`

- [ ] **Step 1: Create barrel exports for all new components**

- [ ] **Step 2: Update main plan-response/index.ts**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/plan-response/*/index.ts
git commit -m "chore: add barrel exports for new components"
```

---

## Task 14: Integration Testing

**Files:**
- Modify: `e2e/retirement-quality-v2.spec.ts`

- [ ] **Step 1: Update E2E test for new response format**

Test that:
- Insight cards render with expand/collapse
- Scenario explorer shows with controls
- Action cards are clickable
- Typography looks correct

- [ ] **Step 2: Run tests and fix any failures**

- [ ] **Step 3: Commit**

```bash
git add e2e/retirement-quality-v2.spec.ts
git commit -m "test: update e2e tests for new response styling"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Typography design tokens | tokens.css |
| 2 | Expand button primitive | expand-button.tsx |
| 3 | Metric pill primitive | metric-pill.tsx |
| 4 | Insight card | insight-card.tsx |
| 5 | Action card | action-card.tsx |
| 6 | Comparison card | comparison-card.tsx |
| 7 | Chart controls | chart-controls.tsx |
| 8 | Timeline scrubber | timeline-scrubber.tsx |
| 9 | Scenario explorer | scenario-explorer.tsx |
| 10 | Directive parser updates | directive-parser.ts |
| 11 | Markdown renderer updates | markdown-renderer.tsx |
| 12 | V2 prompt overhaul | prompt-v2.ts |
| 13 | Index exports | */index.ts |
| 14 | Integration testing | e2e tests |
