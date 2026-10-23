import { defineConfig, devices } from '@playwright/test'

// Signed-out smoke test against a deployed Worker: BASE_URL=https://<host> npm run test:prod
// Every test uses a fresh browser context (no cookies, no session), like a private window.
export default defineConfig({
  testDir: 'prod-tests',
  timeout: 45_000,
  reporter: 'list',
  use: { baseURL: process.env.BASE_URL ?? 'https://meishi.orielle.workers.dev' },
  projects: [
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
})
