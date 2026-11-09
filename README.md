# Seat Plan

Guest list and seating planner for Noa and Aiden's wedding: an overhead floor plan of the venue where you place tables and fixtures, drag guests onto seats, and check seating rules. See `docs/SPEC.md` for the brief, `PLAN.md` for how it is built and `DECISIONS.md` for choices the brief left open.

Next.js 16 (App Router, TypeScript), Postgres with Drizzle, Tailwind, Vitest and Playwright. Hosted on Vercel with Neon.

## Run it on your laptop

You need Node 22 and a Postgres 16 server.

1. Make a database, for example:
   ```bash
   createdb seating_dev
   ```
2. Copy `env.example` to `.env.local` and fill in `DATABASE_URL`, `SITE_PASSWORD` and `AUTH_SECRET` (at least 32 characters: `openssl rand -base64 32`).
3. Install, migrate, add demo data and start:
   ```bash
   npm install
   npm run db:migrate
   npm run seed
   npm run dev
   ```
4. Open http://localhost:3000 and enter the site password.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build`, `npm start` | Production build and server |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm test` | Vitest: unit tests and database tests (needs `seating_test`, see below) |
| `npm run e2e` | Playwright on a production build, at 1440 px and 390 px (needs `seating_e2e`) |
| `npm run db:generate` | Make a migration from changes to `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL_UNPOOLED`, else `DATABASE_URL` (the seed uses the same order) |
| `npm run seed` | Demo data. For now one demo wedding; guests, groups, rules and layouts arrive with later milestones. Safe to run twice. |
| `npm run check:secrets` | Fails if the site password is in the built browser files or in git history |

Tests use local databases only and refuse any other host. Create them once:

```bash
createdb seating_test
createdb seating_e2e
```

They default to `postgres://seating:seating@127.0.0.1:5432/...`; set `TEST_DATABASE_URL` and `E2E_DATABASE_URL` to use others. Playwright makes up a fresh site password for each run, so tests never hold the real one.

## Deploy

1. In Vercel, import the GitHub repo. `vercel.json` sets the build command. This first deployment fails, because there is no database or password yet. That is expected; step 4 redeploys it.
2. Storage, then Marketplace, then Neon: create a database in **AWS us-east-1** (Vercel runs the app there by default, so queries stay fast) and connect it to **Production only**.
3. Environment Variables for Production: `SITE_PASSWORD`, `AUTH_SECRET` (at least 32 characters: `openssl rand -base64 32`), and from milestone 7 `ANTHROPIC_API_KEY`.
4. Redeploy. Production builds check those settings and name any that are missing, apply migrations, build, and fail if the password shows up in the build output. Preview builds skip the database.

Signing out everywhere: change `AUTH_SECRET` (or `SITE_PASSWORD`) in Vercel and redeploy.
