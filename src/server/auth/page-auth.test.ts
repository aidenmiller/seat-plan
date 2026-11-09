/**
 * A layout's auth check does not stop its pages from rendering (Next.js docs,
 * "Layouts and auth checks"). So every page that reads data checks the site
 * cookie itself. This test reads the page files and fails if one does not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = path.resolve(__dirname, '../../app')
/** Pages that open without the site cookie. Share pages run their own check. */
const OPEN_PAGES = new Set(['login/page.tsx'])

function pageFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...pageFiles(full))
    else if (name === 'page.tsx' || name === 'page.ts') out.push(full)
  }
  return out
}

describe('pages check the cookie themselves', () => {
  const files = pageFiles(APP_DIR).map((f) => path.relative(APP_DIR, f).split(path.sep).join('/'))

  for (const file of files) {
    if (OPEN_PAGES.has(file)) continue
    it(file, () => {
      const source = readFileSync(path.join(APP_DIR, file), 'utf8')
      if (file.startsWith('share/')) {
        expect(source, `${file} must check the share cookie`).toMatch(/requireShareAccess\(/)
      } else {
        expect(source, `${file} must call requireSiteSession()`).toMatch(/await requireSiteSession\(/)
      }
    })
  }
})
