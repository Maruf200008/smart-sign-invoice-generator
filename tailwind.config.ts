import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

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
        // UI chrome: Inter for Latin, then the bundled Bengali chain (--invoice-font, defined in font-registry.ts).
        sans: ["var(--font-inter)", "var(--invoice-font)"],
        bangla: ["var(--invoice-font)"],
        // The invoice itself: one font chain shared with the PDF engine.
        invoice: ["var(--invoice-font)"]
      }
    }
  },
  plugins: [
    // `sysdark:` applies when the OS prefers dark OR an ancestor has `.dark`. Used by the share UI so it follows the
    // system theme without changing how the existing `dark:` (class-only) styles behave on the light-only dashboard.
    plugin(({ addVariant }) => {
      addVariant("sysdark", ["@media (prefers-color-scheme: dark)", ".dark &"]);
    })
  ]
};

export default config;
