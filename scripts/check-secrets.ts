/**
 * Fails if the site password appears in the built browser files or in git
 * history (spec section 13). Reads the password from SITE_PASSWORD (or
 * CHECK_PASSWORD), never from the command line, and never prints it.
 *
 *   npm run check:secrets -- --bundle     scan the build output (.next, except its cache) and public/
 *   npm run check:secrets -- --history    scan every commit on every branch: diffs, merges and messages
 *   (no flag)                             both
 *
 * Without a password to look for it skips with a warning, unless --strict.
 */
import { loadEnvConfig } from '@next/env'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

type Hit = { where: string; offset: number; context: string }

export function findAll(haystack: string, needle: string): number[] {
  const out: number[] = []
  if (!needle) return out
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = haystack.indexOf(needle, i + 1)
  }
  return out
}

/** Text around a match with the secret itself replaced, so a hit can be judged safely. */
export function maskedContext(text: string, offset: number, secret: string, radius = 30): string {
  const start = Math.max(0, offset - radius)
  const end = Math.min(text.length, offset + secret.length + radius)
  return text.slice(start, end).split(secret).join('*'.repeat(8)).replace(/\s+/g, ' ')
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

/** Scans everything the build wrote (except Next's cache) and public/. */
export function scanBundle(secret: string, root = process.cwd()): Hit[] {
  const hits: Hit[] = []
  const nextDir = path.join(root, '.next')
  if (!existsSync(nextDir)) console.warn('check-secrets: .next is missing; run the build first.')
  const cacheDir = path.join(nextDir, 'cache') + path.sep
  const files = [...walk(nextDir).filter((f) => !f.startsWith(cacheDir)), ...walk(path.join(root, 'public'))]
  const needle = Buffer.from(secret, 'utf8').toString('latin1')
  for (const file of files) {
    const text = readFileSync(file).toString('latin1')
    for (const offset of findAll(text, needle)) {
      hits.push({ where: path.relative(root, file), offset, context: maskedContext(text, offset, needle) })
    }
  }
  return hits
}

/** Scans every commit's message and diff, merge commits included (--cc shows their resolutions). */
export function scanHistory(secret: string, cwd = process.cwd()): Promise<Hit[]> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', ['log', '--all', '-p', '--cc', '--no-color', '--format=commit %H%n%B'], {
      cwd,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const hits: Hit[] = []
    let commit = '(none)'
    let tail = ''
    git.stdout.setEncoding('utf8')
    git.stdout.on('data', (chunk: string) => {
      const text = tail + chunk
      const lines = text.split('\n')
      tail = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('commit ')) commit = line.slice(7, 19)
        for (const offset of findAll(line, secret)) {
          hits.push({ where: `commit ${commit}`, offset, context: maskedContext(line, offset, secret) })
        }
      }
    })
    git.on('error', reject)
    git.on('close', (code) => {
      for (const offset of findAll(tail, secret)) {
        hits.push({ where: `commit ${commit}`, offset, context: maskedContext(tail, offset, secret) })
      }
      if (code !== 0) reject(new Error(`git log exited with ${code}`))
      else resolve(hits)
    })
  })
}

async function main() {
  loadEnvConfig(process.cwd())
  const args = new Set(process.argv.slice(2))
  const doBundle = args.has('--bundle') || (!args.has('--history') && !args.has('--bundle'))
  const doHistory = args.has('--history') || (!args.has('--history') && !args.has('--bundle'))
  const secret = process.env.CHECK_PASSWORD || process.env.SITE_PASSWORD || ''

  if (!secret) {
    const message = 'check-secrets: no SITE_PASSWORD to look for.'
    if (args.has('--strict')) {
      console.error(`${message} Failing because of --strict.`)
      process.exit(1)
    }
    console.warn(`${message} Skipping.`)
    return
  }

  const hits: Hit[] = []
  if (doBundle) hits.push(...scanBundle(secret))
  if (doHistory) hits.push(...(await scanHistory(secret)))

  if (hits.length > 0) {
    console.error(`check-secrets: found the site password ${hits.length} time(s):`)
    for (const hit of hits.slice(0, 50)) console.error(`  ${hit.where} @${hit.offset}: …${hit.context}…`)
    process.exit(1)
  }
  console.log(`check-secrets: clean (${[doBundle && 'bundle', doHistory && 'git history'].filter(Boolean).join(' and ')}).`)
}

if (process.argv[1]?.endsWith('check-secrets.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
