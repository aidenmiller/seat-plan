import { resetDatabase } from '../scripts/reset-test-db'

/** A fresh, migrated database for every run. */
export default async function globalSetup() {
  await resetDatabase(process.env.E2E_DATABASE_URL!)
}
