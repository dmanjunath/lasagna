import { motion } from 'framer-motion';

interface LogoProps {
  width?: number;
  className?: string;
  animate?: boolean;
}

export function Logo({ width = 30, className = '', animate = true }: LogoProps) {
  const height = Math.round(width * 26 / 36);
  const uid = Math.random().toString(36).slice(2, 9);
  const gradId = `lasagna-lg-${uid}`;

  const bars = [
    { y: 0,  w: 13 },
    { y: 10, w: 24 },
    { y: 20, w: 36 },
  ];

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 36 26"
      fill="none"
      className={className}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00e5a0" />
          <stop offset="100%" stopColor="#00e5a0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {bars.map((bar, i) => (
        <motion.rect
          key={i}
          x={0}
          y={bar.y}
          width={bar.w}
          height={6}
          rx={3}
          fill={`url(#${gradId})`}
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
