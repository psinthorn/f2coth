import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#1e293b",
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
        },
        accent: {
          DEFAULT: "#7c3aed",
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'DM Serif Display'", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)",
        "card-hover": "0 4px 8px rgba(15,23,42,0.06), 0 16px 32px rgba(15,23,42,0.10)",
      },
      borderRadius: { xl: "1rem", "2xl": "1.5rem" },
    },
  },
  plugins: [],
};

export default config;
