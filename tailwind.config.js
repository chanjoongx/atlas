/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'city-dark': '#0f172a',
        'city-slate': '#1e293b',
        'city-blue': '#3b82f6',
        'city-cyan': '#06b6d4',
        'city-amber': '#f59e0b',
      },
    },
  },
  plugins: [],
}

// Made with Bob
