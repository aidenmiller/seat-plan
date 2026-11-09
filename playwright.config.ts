/**
 * End-to-end tests run against a production build (next build && next start)
 * and a fresh local database. Every run makes up its own site password and
 * secret, so the real password never appears in a test.
 *
 * Projects (spec section 4: check every milestone at 390 px and 1440 px):
 *   desktop  1440 x 900
 *   phone    390 x 844 with touch, in Chromium (Safari's engine is not
 *            installable in this sandbox; real iPhones are checked by hand)
 */
import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://seating:seating@127.0.0.1:5432/seating_e2e'

// Set once in the runner; worker processes inherit these.
process.env.E2E_SITE_PASSWORD ??= `e2e-${randomBytes(12).toString('hex')}`
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString('base64')
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL
process.env.E2E_BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14'].userAgent,
      },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? `npx next start -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SITE_PASSWORD: process.env.E2E_SITE_PASSWORD,
      AUTH_SECRET: process.env.E2E_AUTH_SECRET,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
})
