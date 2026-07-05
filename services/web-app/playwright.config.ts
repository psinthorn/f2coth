import { defineConfig } from "@playwright/test";

// Minimal Playwright config — one Chromium project, tests live in ./e2e.
// The dev server should already be running (make up) before `npm run test:e2e`.
// BASE_URL defaults to the local Traefik gateway.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
