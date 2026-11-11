/**
 * A layout's auth check does not stop its pages from rendering (Next.js docs,
 * "Layouts and auth checks"). So every page checks for itself, with the guard
 * its path calls for, and this test reads the files and fails if one does not.
 * The wedding layouts check too (they hand the role down to the screens), and
 * so do the two signed-in layouts (they hand the user down).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = path.resolve(__dirname, '../../app')

type Rule = {
  /** Shown when the file fails. */
  guard: string
  /** What the file's source must contain. */
  required: RegExp
  /** Layouts under this rule need the call as well as its pages. */
  layouts: boolean
}

/**
 * Pages that open without a session, each with the check it must run
 * instead. invite and reset are the next phase's pages; they do not exist yet.
 */
const OPEN_PAGES = new Map<string, Rule>([
  // Sends a signed-in visitor on only when the database still holds their session.
  ['login/page.tsx', { guard: 'getSessionUser()', required: /await getSessionUser\(/, layouts: false }],
  // The 404 page unless setup is still open.
  ['setup/page.tsx', { guard: 'the setup check', required: /if \(!\(await setupOpen\(\)\)\) notFound\(\)/, layouts: false }],
  ['invite/page.tsx', { guard: 'its own check', required: /\S/, layouts: false }],
  ['reset/page.tsx', { guard: 'its own check', required: /\S/, layouts: false }],
])

const WEDDING_RULE: Rule = { guard: 'await requireWeddingPage(', required: /await requireWeddingPage\(/, layouts: true }

/** The (path prefix, rule) pairs, first match wins. Everything else needs a signed-in user. */
const PREFIX_RULES: Array<[prefix: string, rule: Rule]> = [
  // Share pages run their own check: the share cookie, not an account.
  ['share/', { guard: 'requireShareAccess(', required: /requireShareAccess\(/, layouts: false }],
  ['(app)/w/[weddingId]/', WEDDING_RULE],
  ['(editor)/w/', WEDDING_RULE],
  ['(editor)/venues/', { guard: 'await requireVenuePage(', required: /await requireVenuePage\(/, layouts: false }],
  ['(app)/admin/', { guard: 'await requireAdminPage(', required: /await requireAdminPage\(/, layouts: false }],
]

const SIGNED_IN_RULE: Rule = { guard: 'await requireUser(', required: /await requireUser\(/, layouts: false }

/** The rule for a file path (relative to src/app, forward slashes). */
function ruleFor(file: string): Rule {
  const open = OPEN_PAGES.get(file)
  if (open) return open
  for (const [prefix, rule] of PREFIX_RULES) if (file.startsWith(prefix)) return rule
  return SIGNED_IN_RULE
}

function walk(dir: string, pick: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, pick))
    else if (pick(name)) out.push(full)
  }
  return out
}

function relative(files: string[]): string[] {
  return files.map((f) => path.relative(APP_DIR, f).split(path.sep).join('/'))
}

describe('the rules map each path to its guard', () => {
  it('sends wedding pages and layouts to requireWeddingPage', () => {
    for (const file of [
      '(app)/w/[weddingId]/page.tsx',
      '(app)/w/[weddingId]/layout.tsx',
      '(app)/w/[weddingId]/(tabs)/guests/page.tsx',
      '(editor)/w/[weddingId]/layouts/[layoutId]/page.tsx',
      '(editor)/w/[weddingId]/layout.tsx',
    ]) {
      expect(ruleFor(file).guard, file).toBe('await requireWeddingPage(')
    }
  })

  it('sends venue, admin, share and every other page to its own guard', () => {
    expect(ruleFor('(editor)/venues/[templateId]/page.tsx').guard).toBe('await requireVenuePage(')
    expect(ruleFor('(app)/admin/users/page.tsx').guard).toBe('await requireAdminPage(')
    expect(ruleFor('share/[token]/page.tsx').guard).toBe('requireShareAccess(')
    expect(ruleFor('(app)/page.tsx').guard).toBe('await requireUser(')
    expect(ruleFor('(app)/account/page.tsx').guard).toBe('await requireUser(')
  })

  it('opens exactly login, setup, invite and reset', () => {
    expect([...OPEN_PAGES.keys()].sort()).toEqual(['invite/page.tsx', 'login/page.tsx', 'reset/page.tsx', 'setup/page.tsx'])
  })

  it('checks layouts only where they hand something down', () => {
    expect(ruleFor('(app)/w/[weddingId]/layout.tsx').layouts).toBe(true)
    expect(ruleFor('(editor)/venues/[templateId]/page.tsx').layouts).toBe(false)
  })
})

describe('pages check the session themselves', () => {
  const files = relative(walk(APP_DIR, (name) => name === 'page.tsx' || name === 'page.ts'))

  it('finds the open pages that exist', () => {
    for (const file of ['login/page.tsx', 'setup/page.tsx']) expect(files).toContain(file)
  })

  for (const file of files) {
    it(file, () => {
      const rule = ruleFor(file)
      const source = readFileSync(path.join(APP_DIR, file), 'utf8')
      expect(source, `${file} must call ${rule.guard}`).toMatch(rule.required)
    })
  }
})

describe('the wedding layouts check too, and hand the role down', () => {
  const layouts = relative(walk(APP_DIR, (name) => name === 'layout.tsx')).filter((f) => ruleFor(f).layouts)

  it('finds the wedding layout', () => {
    expect(layouts).toContain('(app)/w/[weddingId]/layout.tsx')
  })

  for (const file of layouts) {
    it(file, () => {
      const rule = ruleFor(file)
      const source = readFileSync(path.join(APP_DIR, file), 'utf8')
      expect(source, `${file} must call ${rule.guard}`).toMatch(rule.required)
      expect(source).toMatch(/<WeddingAccessProvider /)
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
