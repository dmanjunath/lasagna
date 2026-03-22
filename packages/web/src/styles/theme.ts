export const colors = {
  bg: {
    DEFAULT: '#0c0a09',
    elevated: '#1c1917',
    subtle: '#292524',
  },
  surface: {
    DEFAULT: 'rgba(41, 37, 36, 0.6)',
    solid: '#292524',
    hover: 'rgba(68, 64, 60, 0.5)',
  },
  border: {
    DEFAULT: 'rgba(120, 113, 108, 0.2)',
    light: 'rgba(168, 162, 158, 0.15)',
    accent: 'rgba(251, 191, 36, 0.3)',
  },
  text: {
    DEFAULT: '#fafaf9',
    secondary: '#d6d3d1',
    muted: '#a8a29e',
  },
  accent: {
    DEFAULT: '#fbbf24',
    dim: '#d97706',
    glow: 'rgba(251, 191, 36, 0.15)',
  },
  success: '#4ade80',
  warning: '#fb923c',
  danger: '#f87171',
} as const;

export const fonts = {
  sans: ['DM Sans', 'system-ui', 'sans-serif'],
  display: ['Fraunces', 'Georgia', 'serif'],
} as const;
