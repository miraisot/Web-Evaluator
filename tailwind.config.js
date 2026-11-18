/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vs: {
          // Mirai School of Technology palette (miraisot.com): deep navy
          // surfaces with the brand's blue -> teal accent.
          bg: '#060a24',
          sidebar: '#0b1130',
          panel: '#141b40',
          border: '#252e5c',
          text: '#d5dbf0',
          mute: '#8a93ba',
          accent: '#1d8fd6',
        },
        mirai: {
          navy: '#020523',
          blue: '#194CD1',
          teal: '#069BAD',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
        mono: ['Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
