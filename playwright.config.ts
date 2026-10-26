import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 90000,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm run dev -- --hostname localhost --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60000,
  },
})
