import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import type { SliderControlBlock } from "../../../lib/types.js";

export function SliderControlRenderer({ block }: { block: SliderControlBlock }) {
  const [value, setValue] = useState(block.currentValue);

  const formatValue = useCallback((v: number) => {
    if (block.controlType === "swr") {
      return `${(v * 100).toFixed(1)}%`;
    }
    if (block.controlType === "retirement_age") {
      return `Age ${v}`;
    }
    return `$${v.toLocaleString()}${block.unit || ""}`;
  }, [block.controlType, block.unit]);

  const getImpactForValue = useCallback((v: number) => {
    if (!block.impactPreview) return null;
    const closest = block.impactPreview.values.reduce((prev, curr) =>
      Math.abs(curr.value - v) < Math.abs(prev.value - v) ? curr : prev
    );
    return closest.result;
  }, [block.impactPreview]);

  const percentage = ((value - block.min) / (block.max - block.min)) * 100;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <label className="text-sm font-medium text-text">{block.label}</label>
        <span className="text-lg font-semibold text-accent tabular-nums">
          {formatValue(value)}
        </span>
      </div>

      <div className="relative">
        <input
          type="range"
          min={block.min}
          max={block.max}
          step={block.step}
          value={value}
          onChange={(e) => setValue(parseFloat(e.target.value))}
          className="w-full h-2 bg-surface rounded-full appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-5
                     [&::-webkit-slider-thumb]:h-5
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-accent
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:shadow-lg
                     [&::-webkit-slider-thumb]:transition-transform
                     [&::-webkit-slider-thumb]:hover:scale-110"
        />
        <div
          className="absolute top-0 left-0 h-2 bg-accent/30 rounded-full pointer-events-none"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-text-muted mt-2">
        <span>{formatValue(block.min)}</span>
        <span>{formatValue(block.max)}</span>
      </div>

      {block.impactPreview && (
        <motion.div
          key={value}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 bg-surface rounded-lg border border-border"
        >
          <span className="text-sm text-text-muted">{block.impactPreview.label}: </span>
          <span className="text-sm font-medium text-text">{getImpactForValue(value)}</span>
        </motion.div>
      )}
    </div>
  );
}
