/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        petrol: {
          950: '#0a1f26',
          900: '#0d2830',
          800: '#123640',
          700: '#1a4752',
          600: '#255a67',
          500: '#347080',
        },
        amber: {
          400: '#e8a83c',
          500: '#d69428',
          600: '#b87a1c',
        },
        canvas: '#f5f6f4',
        line: '#e2e4df',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
