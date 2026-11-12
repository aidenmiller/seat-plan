import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX, PASSWORD_MIN, hashUserPassword, passwordLengthOk, verifyUserPassword } from './passwords'

describe('account passwords', () => {
  it('hash with argon2id at the chosen cost, salted', async () => {
    const a = await hashUserPassword('correct horse battery')
    const b = await hashUserPassword('correct horse battery')
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(a).not.toBe(b)
  })

  it('verify only the exact password', async () => {
    const hash = await hashUserPassword('correct horse battery')
    expect(await verifyUserPassword(hash, 'correct horse battery')).toBe(true)
    expect(await verifyUserPassword(hash, 'Correct horse battery')).toBe(false)
    expect(await verifyUserPassword(hash, 'correct horse battery ')).toBe(false)
    expect(await verifyUserPassword(hash, '')).toBe(false)
  })

  it('answer false for an unknown account after a real check against the dummy hash', async () => {
    // Functional, not timing: no hash still takes the argon2 path and never says yes,
    // whatever is typed (including the empty string).
    for (const pw of ['correct horse battery', '', 'x'.repeat(PASSWORD_MAX)]) {
      expect(await verifyUserPassword(null, pw)).toBe(false)
    }
    const started = performance.now()
    await verifyUserPassword(null, 'some password')
    // An argon2id check at 19 MiB takes milliseconds; a shortcut would take microseconds.
    expect(performance.now() - started).toBeGreaterThan(1)
  })

  it('treat a broken hash as a wrong password', async () => {
    expect(await verifyUserPassword('not a hash', 'correct horse battery')).toBe(false)
    expect(await verifyUserPassword('', 'correct horse battery')).toBe(false)
  })

  it(`allow ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`, async () => {
    expect(passwordLengthOk('x'.repeat(PASSWORD_MIN - 1))).toBe(false)
    expect(passwordLengthOk('x'.repeat(PASSWORD_MIN))).toBe(true)
    expect(passwordLengthOk('x'.repeat(PASSWORD_MAX))).toBe(true)
    expect(passwordLengthOk('x'.repeat(PASSWORD_MAX + 1))).toBe(false)
    await expect(hashUserPassword('x'.repeat(PASSWORD_MIN - 1))).rejects.toThrow()
    await expect(hashUserPassword('x'.repeat(PASSWORD_MAX + 1))).rejects.toThrow()
    await expect(hashUserPassword('x'.repeat(PASSWORD_MAX))).resolves.toMatch(/^\$argon2id\$/)
  })

  it('refuse a password over the limit without checking it', async () => {
    const hash = await hashUserPassword('x'.repeat(PASSWORD_MAX))
    expect(await verifyUserPassword(hash, 'x'.repeat(PASSWORD_MAX))).toBe(true)
    expect(await verifyUserPassword(hash, 'x'.repeat(PASSWORD_MAX + 1))).toBe(false)
  })
})
