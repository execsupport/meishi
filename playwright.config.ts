import { defineConfig, devices } from '@playwright/test'

const PORT = 8789
// Local run: wrangler dev with DEV_LOGIN=1 (.dev.vars). Set REMOTE_AI=1 to use the real
// Workers AI binding (needs `wrangler login`) instead of the AI-less test config.
const config = process.env.REMOTE_AI ? 'wrangler.jsonc' : 'wrangler.test.jsonc'

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts/,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: `npx wrangler d1 migrations apply meishi --local -c ${config} && npx wrangler dev -c ${config} --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
})
