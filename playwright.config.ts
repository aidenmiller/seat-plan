/**
 * End-to-end tests run against a production build (next build && next start)
 * and a fresh local database. Every run makes up its own site password,
 * secret and account passwords, so no real password ever appears in a test.
 *
 * Projects (spec section 4: check every milestone at 390 px and 1440 px):
 *   desktop  1440 x 900
 *   phone    390 x 844 with touch, in Chromium (Safari's engine is not
 *            installable in this sandbox; real iPhones are checked by hand)
 *
 * The floor plan import talks to a stand-in Anthropic API that global setup
 * starts on port 4210 (e2e/stand-in-anthropic.ts). The app gets its address
 * and a dummy key explicitly, since the shell may hold its own
 * ANTHROPIC_BASE_URL and the app must never reach the real API from a test.
 */
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
// TEST_DB_SUFFIX (for example "_b") picks a second set of databases from scripts/create-test-dbs.ts.
const SUFFIX = (process.env.TEST_DB_SUFFIX ?? '').replace(/[^a-z0-9_]/gi, '')
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? `postgres://seating:seating@127.0.0.1:5432/seating_e2e${SUFFIX}`
const STAND_IN_PORT = Number(process.env.E2E_STAND_IN_PORT ?? 4210)

// Set once in the runner; worker processes inherit these. The site password
// now only opens /setup, which stays closed because global setup makes the
// run's accounts (e2e/users.ts) with the passwords below.
process.env.E2E_SITE_PASSWORD ??= `e2e-${randomBytes(12).toString('hex')}`
process.env.E2E_PASSWORD_A ??= `e2e-a-${randomBytes(12).toString('hex')}`
process.env.E2E_PASSWORD_B ??= `e2e-b-${randomBytes(12).toString('hex')}`
process.env.E2E_PASSWORD_C ??= `e2e-c-${randomBytes(12).toString('hex')}`
process.env.E2E_AUTH_SECRET ??= randomBytes(32).toString('base64')
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL
process.env.E2E_BASE_URL = `http://localhost:${PORT}`
process.env.E2E_STAND_IN_PORT = String(STAND_IN_PORT)
process.env.E2E_STAND_IN_URL = `http://127.0.0.1:${STAND_IN_PORT}`
// Stored backups: the run's own cron secret, and a fresh folder for the backup store (global setup makes it).
process.env.E2E_CRON_SECRET ??= randomBytes(24).toString('hex')
process.env.E2E_BACKUP_STORE_DIR ??= path.join(os.tmpdir(), `seat-plan-e2e-backups-${randomBytes(6).toString('hex')}`)

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
      // The stand-in Anthropic API, never the real one. The key is a dummy the stand-in accepts.
      ANTHROPIC_BASE_URL: process.env.E2E_STAND_IN_URL,
      ANTHROPIC_API_KEY: 'stand-in-dummy-key',
      FLOORPLAN_MODEL: '',
      CRON_SECRET: process.env.E2E_CRON_SECRET,
      BACKUP_STORE_DIR: process.env.E2E_BACKUP_STORE_DIR,
    },
  },
})
