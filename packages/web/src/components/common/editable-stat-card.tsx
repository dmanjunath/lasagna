import { useState, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EditableStatCardProps {
  label: string;
  value: number;
  // formatValue: (value: number) => string;
  onChange: (value: number) => void;
  icon?: LucideIcon;
  presets?: { label: string; value: number }[];
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  delay?: number;
}

export function EditableStatCard({
  label,
  value,
  onChange,
  icon: Icon,
  min = 0,
  max = 999999,
}: EditableStatCardProps) {
  const [draft, setDraft] = useState(String(value));

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon className="w-5 h-5 text-text-muted" />}
        <span className="text-sm text-text-secondary font-medium">{label}</span>
      </div>
      <input
        type="number"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => {
          // Clean up invalid input on blur
          const v = parseInt(draft, 10);
          if (isNaN(v) || v < min || v > max) setDraft(String(value));
        }}
        className="font-display text-2xl font-semibold tabular-nums bg-transparent border-b-2 border-accent focus:outline-none w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}
