/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* slate 走 CSS 变量：浅色=暖纸色阶，暗色（.dark）= 经典冷灰，随主题自动切换 */
        slate: {
          50: 'rgb(var(--lm-slate-50) / <alpha-value>)',
          100: 'rgb(var(--lm-slate-100) / <alpha-value>)',
          200: 'rgb(var(--lm-slate-200) / <alpha-value>)',
          300: 'rgb(var(--lm-slate-300) / <alpha-value>)',
          400: 'rgb(var(--lm-slate-400) / <alpha-value>)',
          500: 'rgb(var(--lm-slate-500) / <alpha-value>)',
          600: 'rgb(var(--lm-slate-600) / <alpha-value>)',
          700: 'rgb(var(--lm-slate-700) / <alpha-value>)',
          800: 'rgb(var(--lm-slate-800) / <alpha-value>)',
          900: 'rgb(var(--lm-slate-900) / <alpha-value>)',
          950: 'rgb(var(--lm-slate-950) / <alpha-value>)',
        },
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideUp: { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
      },
    },
  },
  plugins: [],
}
