/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
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
      },
      animation: {
        'fade-in': 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
