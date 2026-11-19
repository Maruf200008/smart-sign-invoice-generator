import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps JSX as-is for Next; tests compile it themselves so components can be rendered to markup.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside the React server bundle; tests run server modules directly.
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      AUTH_SECRET: "test-auth-secret-that-is-at-least-32-characters-long"
    }
  }
});
