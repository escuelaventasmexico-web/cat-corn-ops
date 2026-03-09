/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cc: {
          bg: 'var(--cc-bg)',
          surface: 'var(--cc-surface)',
          primary: 'var(--cc-primary)',
          'primary-dark': 'var(--cc-primary-dark)',
          accent: 'var(--cc-accent)',
          'accent-soft': 'var(--cc-accent-soft)',
          cream: 'var(--cc-cream)',
          'text-main': 'var(--cc-text-main)',
          'text-muted': 'var(--cc-text-muted)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}