import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0A0E13", // Flat opaque obsidian background
        surface: {
          DEFAULT: "#11161D", // Flat opaque card background (NO opacity)
          card: "#161C24",
          2: "#161C24",
          3: "#1C232D",
        },
        "surface-card": "#161C24", // Flat nested card background
        toxic: {
          DEFAULT: "#34D399",     // Vibrant mint/emerald green from screenshots
          bright: "#6EE7B7",      // Hover active state
          muted: "#10B981",       // Medium green
          border: "#163A2D",      // Hairline resting border
          bg: "#0D281E",          // Flat dark-tinted badge fill (NO alpha blur)
        },
        // Alias tokens mapped to emerald/mint green palette
        pump: {
          DEFAULT: "#34D399",
          pill: "#6EE7B7",
          dim: "#065F46",
          hover: "#6EE7B7",
          border: "#163A2D",
          glow: "transparent",
          bg: "#0D281E",
        },
        accent: {
          DEFAULT: "#34D399",
          hover: "#6EE7B7",
          pill: "#6EE7B7",
          ink: "#0A0E13",
        },
        line: "#163A2D",
        ink: "#EAECEF",
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
        hairline: "#163A2D",
        "hairline-hover": "#10B981",
      },
      borderRadius: {
        DEFAULT: "2px",
        sm: "2px",
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
