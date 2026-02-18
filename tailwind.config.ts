import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        night: {
          50: "#f0f0f5",
          100: "#e0e0eb",
          200: "#c1c1d7",
          300: "#9393b8",
          400: "#6b6b99",
          500: "#4e4e7a",
          600: "#3c3c62",
          700: "#2a2a4a",
          800: "#1a1a30",
          900: "#0d0d1a",
          950: "#06060d",
        },
        aurora: {
          green: "#4fffb0",
          blue: "#00d4ff",
          purple: "#b44fff",
          gold: "#ffd166",
        },
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease forwards",
        "slide-up": "slideUp 0.4s ease forwards",
        pulse2: "pulse2 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulse2: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
