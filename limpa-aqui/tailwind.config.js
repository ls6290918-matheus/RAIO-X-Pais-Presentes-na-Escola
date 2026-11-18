/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        petroleo: { DEFAULT: "#102C35", 600: "#163B46", 700: "#0C232A" },
        agua: { DEFAULT: "#61D6C3", 600: "#3FC3AE", 50: "#E8F9F6" },
        nevoa: "#F3F6F6",
        grafite: { DEFAULT: "#25343A", 500: "#5B6B71", 300: "#A5B1B5" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(16,44,53,0.04), 0 4px 16px rgba(16,44,53,0.06)" },
    },
  },
  plugins: [],
};
