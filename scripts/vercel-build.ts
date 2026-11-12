/**
 * The Vercel build (vercel.json buildCommand), in this order:
 *  1. Production builds check their settings (a missing one fails the build
 *     before anything else runs).
 *  2. next build. No page or route needs the database at build time (every
 *     page that reads it is dynamic), so the build does not need the migrated
 *     schema.
 *  3. Fail the build if a secret (AUTH_SECRET, or SITE_PASSWORD when set)
 *     appears in the build output (scripts/check-secrets.ts).
 *  4. Production only: apply database migrations, last. A build that fails in
 *     step 2 or 3 leaves the database as the still-serving old deployment
 *     expects it (a migration can change stored values the old code reads, such
 *     as 0007 rewriting guests.side). A migration failure still fails the build.
 *  Preview builds never touch the database (PLAN change 29).
 */
import { spawnSync } from 'node:child_process'

function run(command: string, args: string[]) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/**
 * Names what is wrong, never a value. SITE_PASSWORD is no longer needed: it
 * only opens first-run setup (/setup), and BOOTSTRAP_ADMIN_EMAIL is checked
 * when someone uses that page.
 */
export function productionSettingsProblems(env: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = []
  if ((env.AUTH_SECRET ?? '').length < 32) {
    problems.push('AUTH_SECRET is missing or shorter than 32 characters. Make one with: openssl rand -base64 32')
  }
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set. Open Storage, connect the Neon database to Production, then redeploy.')
  }
  // The nightly backup (vercel.json crons, src/app/api/cron/backups). Vercel sends the secret in a header, so letters and digits only.
  if (!/^[A-Za-z0-9]{32,}$/.test(env.CRON_SECRET ?? '')) {
    problems.push(
      'CRON_SECRET is missing, shorter than 32 characters, or holds characters other than letters and digits. Make one with: openssl rand -hex 32',
    )
  }
  if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) {
    problems.push('No Blob store is connected, so nightly backups have nowhere to go. Open Storage, create a PRIVATE Blob store and connect it to Production, then redeploy.')
  }
  if (env.BACKUP_STORE_DIR) {
    problems.push('BACKUP_STORE_DIR is for local runs only (a Vercel function cannot keep files). Remove it from Production.')
  }
  return problems
}

export type BuildStep = { label: string; command: string; args: string[] }

/** The commands to run, in order, once the production settings have passed. */
export function buildSteps(vercelEnv: string): BuildStep[] {
  const production = vercelEnv === 'production'
  return [
    { label: 'build', command: 'npx', args: ['next', 'build'] },
    { label: 'secret check', command: 'npm', args: ['run', 'check:secrets', '--', '--bundle', ...(production ? ['--strict'] : [])] },
    ...(production ? [{ label: 'migrate', command: 'npm', args: ['run', 'db:migrate'] }] : []),
  ]
}

if (process.argv[1]?.endsWith('vercel-build.ts')) {
  const vercelEnv = process.env.VERCEL_ENV ?? 'local'
  if (vercelEnv === 'production') {
    const problems = productionSettingsProblems(process.env)
    if (problems.length > 0) {
      console.error('\nThis production build is missing settings:')
      for (const problem of problems) console.error(`  - ${problem}`)
      process.exit(1)
    }
  } else {
    console.log(`Skipping migrations (VERCEL_ENV=${vercelEnv}).`)
  }
  for (const step of buildSteps(vercelEnv)) run(step.command, step.args)
}
