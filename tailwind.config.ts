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
          DEFAULT: "#4DFE15", // Core toxic lime
          bright: "#76FF32", // Hover active state
          muted: "#245415", // Low-contrast flat borders
          border: "#1C3D12", // Hairline resting border
          bg: "#0E1A0C", // Flat dark-tinted badge fill (NO alpha blur)
        },
        // Alias tokens mapped to exact Hard Flat Toxic palette
        pump: {
          DEFAULT: "#4DFE15",
          pill: "#76FF32",
          dim: "#245415",
          hover: "#76FF32",
          border: "#1C3D12",
          glow: "transparent",
          bg: "#0E1A0C",
        },
        accent: {
          DEFAULT: "#4DFE15",
          hover: "#76FF32",
          pill: "#76FF32",
          ink: "#0A0E13",
        },
        line: "#1C3D12",
        ink: "#EAECEF",
        muted: "#848E9C",
        dim: "#474D57",
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
        hairline: "#1C3D12",
        "hairline-hover": "#245415",
      },
      borderRadius: {
        DEFAULT: "2px",
        sm: "2px",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "Impact", "Arial Narrow", "sans-serif"],
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
