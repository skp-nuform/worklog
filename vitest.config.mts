import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vite 8 resolves tsconfig `paths` natively; vite-tsconfig-paths is no
  // longer needed and warns if present.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // Playwright owns tests/e2e. Vitest cannot render async Server
    // Components, so those journeys are covered end-to-end instead.
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
  },
});
