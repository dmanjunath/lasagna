import { useCallback, useRef, useState, useEffect } from 'react';
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

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      onChange(calculateYear(e.clientX));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, calculateYear, onChange]);

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
