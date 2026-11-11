import { resetDatabase } from '../scripts/reset-test-db'
import { dbCreateUser } from './db'
import { DEFAULT_STAND_IN_PORT, startStandIn } from './stand-in-anthropic'
import { E2E_USERS, userPassword, type Who } from './users'

/**
 * A fresh, migrated database for every run, with the run's three accounts
 * (e2e/users.ts), and the stand-in Anthropic API the app's floor plan import
 * talks to (playwright.config.ts points the app at it). The database is
 * emptied only here, once per run, so the accounts last the whole run. The
 * returned function stops the stand-in when the run ends.
 */
export default async function globalSetup() {
  await resetDatabase(process.env.E2E_DATABASE_URL!)
  for (const who of Object.keys(E2E_USERS) as Who[]) {
    const user = E2E_USERS[who]
    await dbCreateUser(user.email, user.displayName, userPassword(who), { admin: user.isAdmin })
  }
  const standIn = await startStandIn(Number(process.env.E2E_STAND_IN_PORT ?? DEFAULT_STAND_IN_PORT))
  return async () => {
    await standIn.close()
  }
}
