import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './hooks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          blue: '#378ADD',
          green: '#1D9E75',
          amber: '#BA7517',
          purple: '#7F77DD',
        },
      },
      letterSpacing: {
        tighter: '-0.03em',
        tight: '-0.015em',
        normal: '0em',
        wide: '0.04em',
        wider: '0.08em',
        widest: '0.12em',
      },
      keyframes: {
        slideInRight: {
          from: { transform: 'translateX(100%)' },
          to:   { transform: 'translateX(0)' },
        },
      },
      animation: {
        slideInRight: 'slideInRight 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
