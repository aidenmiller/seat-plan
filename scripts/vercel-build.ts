/**
 * The Vercel build (vercel.json buildCommand).
 *  1. Production builds check their settings, then apply database migrations.
 *     Preview builds never touch the database (PLAN change 29).
 *  2. next build.
 *  3. Fail the build if the site password appears in the build output.
 */
import { spawnSync } from 'node:child_process'

function run(command: string, args: string[]) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/** Names what is wrong, never a value. */
export function productionSettingsProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = []
  if (!env.SITE_PASSWORD) problems.push('SITE_PASSWORD is not set. Add it under Settings, Environment Variables.')
  if ((env.AUTH_SECRET ?? '').length < 32) {
    problems.push('AUTH_SECRET is missing or shorter than 32 characters. Make one with: openssl rand -base64 32')
  }
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set. Open Storage, connect the Neon database to Production, then redeploy.')
  }
  return problems
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
    run('npm', ['run', 'db:migrate'])
  } else {
    console.log(`Skipping migrations (VERCEL_ENV=${vercelEnv}).`)
  }
  run('npx', ['next', 'build'])
  run('npm', ['run', 'check:secrets', '--', '--bundle', ...(vercelEnv === 'production' ? ['--strict'] : [])])
}
