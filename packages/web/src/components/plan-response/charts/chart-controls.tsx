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
