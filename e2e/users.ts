/**
 * The three accounts every end-to-end run starts with: A is an admin, B and C
 * are not. Global setup makes them (e2e/global-setup.ts) right after emptying
 * the database, with passwords playwright.config.ts makes up for each run, so
 * no real password ever appears in a test.
 */
export type Who = 'a' | 'b' | 'c'

export type E2EUser = { email: string; displayName: string; isAdmin: boolean; passwordEnv: string }

export const E2E_USERS: Record<Who, E2EUser> = {
  a: { email: 'avery@e2e.seat-plan.test', displayName: 'Avery', isAdmin: true, passwordEnv: 'E2E_PASSWORD_A' },
  b: { email: 'blake@e2e.seat-plan.test', displayName: 'Blake', isAdmin: false, passwordEnv: 'E2E_PASSWORD_B' },
  c: { email: 'casey@e2e.seat-plan.test', displayName: 'Casey', isAdmin: false, passwordEnv: 'E2E_PASSWORD_C' },
}

/** The password this run made up for the user. */
export function userPassword(who: Who): string {
  const name = E2E_USERS[who].passwordEnv
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; run through playwright.config.ts`)
  return value
}
