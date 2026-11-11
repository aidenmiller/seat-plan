import 'server-only'
import { hash, verify, type Algorithm } from '@node-rs/argon2'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/domain/accounts'

/**
 * Account passwords: argon2id with OWASP's suggested cost (19 MiB, two
 * passes, one lane). The hash string records its own settings, so raising the
 * cost later still verifies older hashes.
 */

export { PASSWORD_MAX, PASSWORD_MIN }

/** Algorithm.Argon2id. The package declares it as a const enum, which isolatedModules cannot read. */
const ARGON2ID = 2 as Algorithm
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 }

/**
 * A hash of a random password nobody kept, made once with the settings above.
 * Checking a password for an unknown email runs against it, so the reply takes
 * as long as for a real account.
 */
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$RSXYyivzvpBPMdis5gVokw$0sWzV6OAz7lt6Ne/EKKWEQflTl3m9JGh8l+jTo4Kwv0'

export function passwordLengthOk(password: string): boolean {
  return password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX
}

/** Throws on a password outside the limits: the routes check those first, so this is a last guard. */
export async function hashUserPassword(password: string): Promise<string> {
  if (!passwordLengthOk(password)) throw new Error(`Passwords are ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`)
  return hash(password, OPTIONS)
}

/**
 * True only when the password matches the hash. With no hash (no such
 * account) it still runs a full check against DUMMY_HASH and answers false.
 * A password longer than PASSWORD_MAX can never have been set, so it is
 * refused before any work, whether or not the account exists.
 */
export async function verifyUserPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (password.length > PASSWORD_MAX) return false
  if (passwordHash === null) {
    await verify(DUMMY_HASH, password).catch(() => false)
    return false
  }
  return verify(passwordHash, password).catch(() => false)
}
