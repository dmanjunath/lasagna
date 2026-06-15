import { motion } from 'framer-motion';

interface LogoProps {
  width?: number;
  className?: string;
  animate?: boolean;
}

// Stacked "noodle" waves — a lasagna layer that doubles as cash flow / signal.
const WAVES = [
  { d: 'M2 7 C5 3.5 8 3.5 11 7 S17 10.5 20 7 S23 3.5 26 7',      color: '#F59E0B' },
  { d: 'M2 12 C5 8.5 8 8.5 11 12 S17 15.5 20 12 S23 8.5 26 12',   color: '#F59E0B' },
  { d: 'M2 17 C5 13.5 8 13.5 11 17 S17 20.5 20 17 S23 13.5 26 17', color: '#F59E0B' },
];

export function Logo({ width = 30, className = '', animate = true }: LogoProps) {
  const height = Math.round((width * 24) / 28);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 28 24"
      fill="none"
      className={className}
    >
      {WAVES.map((wave, i) => (
        <motion.path
          key={i}
          d={wave.d}
          stroke={wave.color}
          strokeWidth={2.4}
          strokeLinecap="round"
          initial={animate ? { pathLength: 0, opacity: 0 } : false}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{
            duration: 0.5,
            delay: i * 0.1,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      ))}
    </svg>
  );
}
