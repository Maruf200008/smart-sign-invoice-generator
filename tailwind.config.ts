import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#141414",
        paper: "#ffffff",
        accent: "#e3272e",
        graphite: "#2a2a2a"
      },
      boxShadow: {
        premium: "0 24px 80px rgba(18, 18, 18, 0.12)"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "var(--font-noto-bengali)", "system-ui", "sans-serif"],
        bangla: ["var(--font-noto-bengali)", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
