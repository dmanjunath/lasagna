export const colors = {
  bg: {
    DEFAULT: '#0c0c0e',
    elevated: '#19191d',
    subtle: '#232328',
  },
  surface: {
    DEFAULT: 'rgba(35, 35, 40, 0.6)',
    solid: '#232328',
    hover: 'rgba(55, 55, 62, 0.5)',
  },
  border: {
    DEFAULT: 'rgba(113, 113, 122, 0.2)',
    light: 'rgba(161, 161, 170, 0.15)',
    accent: 'rgba(52, 199, 89, 0.3)',
  },
  text: {
    DEFAULT: '#e8e8ec',
    secondary: '#a1a1aa',
    muted: '#71717a',
  },
  accent: {
    DEFAULT: '#34c759',
    dim: '#2a9d48',
    glow: 'rgba(52, 199, 89, 0.15)',
  },
  success: '#4ade80',
  warning: '#fb923c',
  danger: '#f87171',
} as const;

export const fonts = {
  sans: ['Outfit', 'system-ui', 'sans-serif'],
  display: ['Fraunces', 'Georgia', 'serif'],
} as const;
