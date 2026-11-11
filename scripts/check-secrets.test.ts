import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findAll, maskedContext, scanBundle, scanHistory, secretsToFind } from './check-secrets'

const NEEDLE = 'made-up-value-for-the-scanner-test'

describe('check-secrets helpers', () => {
  it('finds every match', () => {
    expect(findAll('xx-needle-yy-needle', 'needle')).toEqual([3, 13])
    expect(findAll('nothing here', 'needle')).toEqual([])
    expect(findAll('abc', '')).toEqual([])
  })

  it('never prints the value itself', () => {
    const text = `const a = "${NEEDLE}"; more code`
    const context = maskedContext(text, text.indexOf(NEEDLE), NEEDLE)
    expect(context).not.toContain(NEEDLE)
    expect(context).toContain('********')
  })
})

describe('secretsToFind', () => {
  it('always looks for AUTH_SECRET, and for the site password and CHECK_PASSWORD when set', () => {
    expect(secretsToFind({ AUTH_SECRET: 'a-secret' })).toEqual([{ name: 'AUTH_SECRET', value: 'a-secret' }])
    expect(secretsToFind({ AUTH_SECRET: 'a-secret', SITE_PASSWORD: 'site', CHECK_PASSWORD: 'real' })).toEqual([
      { name: 'AUTH_SECRET', value: 'a-secret' },
      { name: 'SITE_PASSWORD', value: 'site' },
      { name: 'CHECK_PASSWORD', value: 'real' },
    ])
    expect(secretsToFind({ SITE_PASSWORD: 'site' })).toEqual([{ name: 'SITE_PASSWORD', value: 'site' }])
  })

  it('finds nothing to look for when none is set, and looks for a repeated value once', () => {
    expect(secretsToFind({})).toEqual([])
    expect(secretsToFind({ AUTH_SECRET: '', SITE_PASSWORD: '' })).toEqual([])
    expect(secretsToFind({ SITE_PASSWORD: 'same', CHECK_PASSWORD: 'same' })).toEqual([{ name: 'SITE_PASSWORD', value: 'same' }])
  })
})

describe('scanBundle', () => {
  it('looks through all build output except the cache, and public/', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'scan-bundle-'))
    for (const dir of ['.next/server/app', '.next/static/chunks', '.next/cache', 'public']) {
      mkdirSync(path.join(root, dir), { recursive: true })
    }
    writeFileSync(path.join(root, '.next/server/app/page.html'), `<p>${NEEDLE}</p>`)
    writeFileSync(path.join(root, '.next/static/chunks/a.js'), `var a="${NEEDLE}"`)
    writeFileSync(path.join(root, '.next/cache/x'), NEEDLE)
    writeFileSync(path.join(root, 'public/clean.txt'), 'nothing')
    const where = scanBundle(NEEDLE, root)
      .map((h) => h.where.split(path.sep).join('/'))
      .sort()
    expect(where).toEqual(['.next/server/app/page.html', '.next/static/chunks/a.js'])
  })
})

function repoWith(): { dir: string; git: (...args: string[]) => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scan-history-'))
  const git = (...args: string[]) => {
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', ...args], { cwd: dir, stdio: 'pipe' })
  }
  git('init', '-q', '-b', 'main')
  return { dir, git }
}

describe('scanHistory', () => {
  it('finds the value in a commit message and in a merge resolution', async () => {
    const { dir, git } = repoWith()
    writeFileSync(path.join(dir, 'f.txt'), 'base\n')
    git('add', '.')
    git('commit', '-q', '-m', `message holds ${NEEDLE}`)
    git('checkout', '-q', '-b', 'side')
    writeFileSync(path.join(dir, 'f.txt'), 'side\n')
    git('commit', '-q', '-am', 'side')
    git('checkout', '-q', 'main')
    writeFileSync(path.join(dir, 'f.txt'), 'main\n')
    git('commit', '-q', '-am', 'main')
    try {
      git('merge', '-q', 'side')
    } catch {
      // A conflict, as intended.
    }
    writeFileSync(path.join(dir, 'f.txt'), `${NEEDLE}\n`)
    git('commit', '-q', '-am', 'merge')

    const hits = await scanHistory(NEEDLE, dir)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.every((h) => !h.context.includes(NEEDLE))).toBe(true)
  })

  it('reports nothing for a clean repo', async () => {
    const { dir, git } = repoWith()
    writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
    git('add', '.')
    git('commit', '-q', '-m', 'x')
    expect(await scanHistory(NEEDLE, dir)).toEqual([])
  })
})
