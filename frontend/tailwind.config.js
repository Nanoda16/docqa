/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        night: {
          deep: '#060a13',
          DEFAULT: '#0b1322',
          steel: '#16233a',
        },
        moon: {
          steel: '#33517a',
          light: '#7c9cc4',
        },
        champagne: {
          DEFAULT: '#e4b863',
        },
        glass: {
          tile: 'rgba(255, 255, 255, 0.05)',
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          raised: 'rgba(255, 255, 255, 0.14)',
          border: 'rgba(255, 255, 255, 0.15)',
        },
        ok: {
          DEFAULT: '#34d399',
        },
        warn: {
          DEFAULT: '#fbbf24',
        },
        danger: {
          DEFAULT: '#f87171',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'SF Pro Display',
          'PingFang SC',
          'HarmonyOS Sans SC',
          'Source Han Sans SC',
          'Noto Sans SC',
          'Microsoft YaHei UI',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Cascadia Mono',
          'SF Mono',
          'Consolas',
          'ui-monospace',
          'monospace',
        ],
      },
      borderRadius: {
        input: '14px',
        btn: '16px',
        card: '24px',
        panel: '32px',
      },
      transitionTimingFunction: {
        liquid: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
