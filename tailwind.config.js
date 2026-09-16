/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Références à des variables CSS (définies dans index.css, par
        // thème) plutôt que des hex fixes — permet de changer la
        // palette entière au survol d'un attribut data-theme, sans
        // toucher à aucune des classes bg-petrol-800 / text-amber-500
        // etc. déjà utilisées dans toute l'app.
        petrol: {
          950: 'rgb(var(--petrol-950) / <alpha-value>)',
          900: 'rgb(var(--petrol-900) / <alpha-value>)',
          800: 'rgb(var(--petrol-800) / <alpha-value>)',
          700: 'rgb(var(--petrol-700) / <alpha-value>)',
          600: 'rgb(var(--petrol-600) / <alpha-value>)',
          500: 'rgb(var(--petrol-500) / <alpha-value>)',
        },
        amber: {
          400: 'rgb(var(--amber-400) / <alpha-value>)',
          500: 'rgb(var(--amber-500) / <alpha-value>)',
          600: 'rgb(var(--amber-600) / <alpha-value>)',
        },
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
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
