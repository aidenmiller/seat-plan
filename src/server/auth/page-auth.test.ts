/**
 * A layout's auth check does not stop its pages from rendering (Next.js docs,
 * "Layouts and auth checks"). So every page that reads data checks the
 * session itself. This test reads the page files and fails if one does not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = path.resolve(__dirname, '../../app')

/**
 * Pages that open without a session, each with the check it must run
 * instead. Share pages run their own check (below).
 */
const OPEN_PAGES = new Map<string, RegExp>([
  // Sends a signed-in visitor on only when the database still holds their session.
  ['login/page.tsx', /await getSessionUser\(/],
  // The 404 page unless setup is still open.
  ['setup/page.tsx', /if \(!\(await setupOpen\(\)\)\) notFound\(\)/],
])

function pageFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...pageFiles(full))
    else if (name === 'page.tsx' || name === 'page.ts') out.push(full)
  }
  return out
}

describe('pages check the session themselves', () => {
  const files = pageFiles(APP_DIR).map((f) => path.relative(APP_DIR, f).split(path.sep).join('/'))

  it('finds the open pages', () => {
    for (const file of OPEN_PAGES.keys()) expect(files).toContain(file)
  })

  for (const file of files) {
    it(file, () => {
      const source = readFileSync(path.join(APP_DIR, file), 'utf8')
      const open = OPEN_PAGES.get(file)
      if (open) {
        expect(source, `${file} must run its own check`).toMatch(open)
      } else if (file.startsWith('share/')) {
        expect(source, `${file} must check the share cookie`).toMatch(/requireShareAccess\(/)
      } else {
        expect(source, `${file} must call requireSiteSession()`).toMatch(/await requireSiteSession\(/)
      }
    })
  }
})

describe('the signed-in layouts check the session and hand the user down', () => {
  for (const file of ['(app)/layout.tsx', '(editor)/layout.tsx']) {
    it(file, () => {
      const source = readFileSync(path.join(APP_DIR, file), 'utf8')
      expect(source).toMatch(/await requireUser\(/)
      expect(source).toMatch(/<CurrentUserProvider /)
    })
  }
})
