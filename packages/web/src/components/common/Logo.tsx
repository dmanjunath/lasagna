import { motion } from 'framer-motion';

interface LogoProps {
  size?: number;
  className?: string;
  animate?: boolean;
}

export function Logo({ size = 36, className = '', animate = true }: LogoProps) {
  // Unique ID for gradients to avoid conflicts when multiple logos render
  const id = Math.random().toString(36).slice(2, 9);

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      initial={animate ? { opacity: 0, scale: 0.8 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: 0.4,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <defs>
        {/* Axis gradient - subtle warm gray that's visible on dark bg */}
        <linearGradient id={`axisGrad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#78716c" />
          <stop offset="100%" stopColor="#57534e" />
        </linearGradient>

        {/* Amber gradient for growth line */}
        <linearGradient id={`amberGrad-${id}`} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#b45309" />
          <stop offset="50%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>

        {/* Glow filter */}
        <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        {/* Stronger outer glow for the line */}
        <filter id={`outerGlow-${id}`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor="#fbbf24" floodOpacity="0.6" />
          <feComposite in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Axis - L shape */}
      <motion.path
        d="M16 12 L16 64 L68 64"
        fill="none"
        stroke={`url(#axisGrad-${id})`}
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{
          pathLength: {
            duration: 0.7,
            ease: [0.65, 0, 0.35, 1],
          },
          opacity: { duration: 0.2 },
        }}
      />

      {/* Glow layer behind the growth line */}
      <motion.line
        x1={28}
        y1={52}
        x2={52}
        y2={16}
        stroke={`url(#amberGrad-${id})`}
        strokeWidth={6}
        strokeLinecap="round"
        filter={`url(#outerGlow-${id})`}
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 0.7 }}
        transition={{
          duration: 0.5,
          delay: animate ? 0.8 : 0,
          ease: 'easeOut',
        }}
      />

      {/* Growth line - the hero element */}
      <motion.line
        x1={28}
        y1={52}
        x2={52}
        y2={16}
        stroke={`url(#amberGrad-${id})`}
        strokeWidth={3.5}
        strokeLinecap="round"
        initial={animate ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{
          pathLength: {
            duration: 0.5,
            delay: animate ? 0.4 : 0,
            ease: [0.34, 1.56, 0.64, 1], // Spring-like overshoot
          },
          opacity: {
            duration: 0.15,
            delay: animate ? 0.4 : 0,
          },
        }}
      />

      {/* Sparkle dot at the peak */}
      <motion.circle
        cx={52}
        cy={16}
        r={2.5}
        fill="#fef3c7"
        initial={animate ? { scale: 0, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          scale: {
            type: 'spring',
            stiffness: 400,
            damping: 10,
            delay: animate ? 0.9 : 0,
          },
          opacity: {
            duration: 0.2,
            delay: animate ? 0.9 : 0,
          },
        }}
      />
    </motion.svg>
  );
}
