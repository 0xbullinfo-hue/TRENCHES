import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Base canvas & surfaces
        canvas: "#0A0E13", // Main background
        surface: {
          DEFAULT: "#11161D", // Primary card surface
          card: "#161C24",    // Elevated surface
          elevated: "#161C24",
          2: "#161C24",
          3: "#1C232D",       // Secondary surface
          secondary: "#1C232D",
        },
        "surface-card": "#161C24",
        "surface-elevated": "#161C24",
        "surface-secondary": "#1C232D",

        // Primary brand emerald
        brand: {
          DEFAULT: "#34D399",
          primary: "#34D399",
          hover: "#6EE7B7",
        },
        toxic: {
          DEFAULT: "#34D399",     // Vibrant emerald green
          bright: "#6EE7B7",      // Hover active state
          muted: "#10B981",       // Medium green
          border: "#252D38",      // Standard hairline border
          bg: "#0D281E",          // Flat dark-tinted badge fill
        },
        pump: {
          DEFAULT: "#34D399",
          pill: "#6EE7B7",
          dim: "#065F46",
          hover: "#6EE7B7",
          border: "#252D38",
          glow: "transparent",
          bg: "#0D281E",
        },
        accent: {
          DEFAULT: "#34D399",
          hover: "#6EE7B7",
          pill: "#6EE7B7",
          ink: "#0A0E13",
        },

        // Category colours: Alpha Calls (Permanently Purple)
        alpha: {
          DEFAULT: "#A78BFA",
          primary: "#A78BFA",
          strong: "#8B5CF6",
          bg: "#1E1533",
          background: "#1E1533",
          border: "#5B3A91",
          text: "#EDE9FE",
        },

        // Category colours: Social Raids (Permanently Orange)
        raid: {
          DEFAULT: "#FB923C",
          primary: "#FB923C",
          strong: "#F97316",
          bg: "#2B1B10",
          background: "#2B1B10",
          border: "#9A4D1C",
          text: "#FFEDD5",
        },

        // Borders & Semantics
        border: {
          DEFAULT: "#252D38",
          default: "#252D38",
        },
        line: "#252D38",
        ink: "#F8FAFC",
        muted: "#848E9C",
        dim: "#8E9BAE",
        amber: "#F59E0B",
        idle: "#6B7280",
        danger: "#F6465D",
      },
      boxShadow: {
        none: "none",
        DEFAULT: "none",
        sm: "none",
        md: "none",
        lg: "none",
        xl: "none",
        "2xl": "none",
        "pump-glow": "none",
        "pump-pill": "none",
      },
      borderColor: {
        DEFAULT: "#252D38",
        default: "#252D38",
        hairline: "#252D38",
        "hairline-hover": "#34D399",
      },
      borderRadius: {
        none: "0px",
        sm: "4px",
        DEFAULT: "8px",
        md: "6px",
        lg: "8px",
        xl: "12px",
        "2xl": "16px",
        full: "9999px",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
        display: ["Anton", "Impact", "Arial Narrow", "sans-serif"],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
      },
      keyframes: {
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        marquee: "marquee 60s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
