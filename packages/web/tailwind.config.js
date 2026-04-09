/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
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
