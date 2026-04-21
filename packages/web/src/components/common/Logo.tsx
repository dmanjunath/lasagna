import { motion } from 'framer-motion';

interface LogoProps {
  width?: number;
  className?: string;
  animate?: boolean;
}

export function Logo({ width = 30, className = '', animate = true }: LogoProps) {
  const height = Math.round(width * 26 / 36);

  // sauce / cheese / basil — matching .lf-mark pattern
  const bars = [
    { y: 0,  w: 22, color: '#C9543A' },  // sauce
    { y: 10, w: 32, color: '#E6B85C' },  // cheese
    { y: 20, w: 36, color: '#5A6B3F' },  // basil
  ];

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 36 26"
      fill="none"
      className={className}
    >
      {bars.map((bar, i) => (
        <motion.rect
          key={i}
          x={0}
          y={bar.y}
          width={bar.w}
          height={6}
          rx={3}
          fill={bar.color}
          initial={animate ? { opacity: 0, scaleX: 0 } : false}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{
            duration: 0.4,
            delay: i * 0.08,
            ease: [0.16, 1, 0.3, 1],
          }}
          style={{ transformOrigin: 'left center' }}
        />
      ))}
    </svg>
  );
}
