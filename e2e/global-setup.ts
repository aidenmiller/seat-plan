import { resetDatabase } from '../scripts/reset-test-db'
import { DEFAULT_STAND_IN_PORT, startStandIn } from './stand-in-anthropic'

/**
 * A fresh, migrated database for every run, and the stand-in Anthropic API
 * the app's floor plan import talks to (playwright.config.ts points the app
 * at it). The returned function stops the stand-in when the run ends.
 */
export default async function globalSetup() {
  await resetDatabase(process.env.E2E_DATABASE_URL!)
  const standIn = await startStandIn(Number(process.env.E2E_STAND_IN_PORT ?? DEFAULT_STAND_IN_PORT))
  return async () => {
    await standIn.close()
  }
}
