# Seat Plan

Guest list and seating planner for Noa and Aiden's wedding: an overhead floor plan of the venue where you place tables and fixtures, drag guests onto seats, and check seating rules. See `docs/SPEC.md` for the brief, `PLAN.md` for how it is built and `DECISIONS.md` for choices the brief left open.

Next.js 16 (App Router, TypeScript), Postgres with Drizzle, Tailwind, Vitest and Playwright. Hosted on Vercel with Neon.

## Run it on your laptop

You need Node 22 and a Postgres 16 server.

1. Make a database, for example:
   ```bash
   createdb seating_dev
   ```
2. Copy `env.example` to `.env.local` and fill in `DATABASE_URL`, `SITE_PASSWORD` and `AUTH_SECRET` (at least 32 characters: `openssl rand -base64 32`). The floor plan import also needs `ANTHROPIC_API_KEY`; without it everything else works and the import says the key is missing.
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
| `npm run e2e` | Playwright on a production build, at 1440 px and 390 px with touch (needs `seating_e2e`). `E2E_SKIP_BUILD=1` reuses the last build. The speed test (`e2e/perf.spec.ts`) runs in the 1440 px project only. The floor plan import tests talk to a stand-in for the Anthropic API that the run starts on port 4210 (`e2e/stand-in-anthropic.ts`; `E2E_STAND_IN_PORT` picks another), so they need no key and never reach the real API. |
| `npm run db:generate` | Make a migration from changes to `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL_UNPOOLED`, else `DATABASE_URL` (the seed uses the same order) |
| `npm run seed` | Demo data: "Demo wedding" with three reception layouts, "Reception plan A" (blank canvas, five round tables), "Canvas tour" (blank canvas, one of every table preset and fixture) and "Beach Club reception" (Toronto Beach Club). Its guest list (`scripts/demo-guests.ts`, made up from a fixed random seed): 120 guests in households, a few with accents, on Noa's side, Aiden's or both, mostly RSVP yes with some pending and a few no, 10 children, some meals and notes; 8 groups with their members; 20 couples linked as partners; 5 rules (shown from milestone 6). About 80 of them sit at the tables of "Reception plan A" and "Canvas tour" (the sweetheart table stays free). "Canvas tour" also gets a few notes by Noa and Aiden (`scripts/demo-notes.ts`), one marked done, and an arrow attached to the bar and table 3. Safe to run twice: guests match by name, and groups, couples, rules, seats and notes are only added where none are yet. It runs tsx with the `react-server` condition, so it writes through the app's own server code. |
| `npm run seed:perf` | The speed test's layout, for trying pan and zoom by hand on a phone or laptop: a "Speed test" wedding with 400 made-up guests and one layout, "40 tables" (40 round tables of 10 seats, every seat taken, and 100 shapes). Safe to run twice. |
| `npm run check:secrets` | Fails if the site password is in the built browser files or in git history |

Tests use local databases only and refuse any other host. Create them once:

```bash
createdb seating_test
createdb seating_e2e
```

They default to `postgres://seating:seating@127.0.0.1:5432/...`; set `TEST_DATABASE_URL` and `E2E_DATABASE_URL` to use others. Playwright makes up a fresh site password for each run, so tests never hold the real one.

## Venues and the floor plan import

Venues are shared by every wedding: each wedding's Venues tab lists them all, with rename, Duplicate and Delete (blocked while a layout uses the venue; the dialog lists those layouts, each with Change venue to move it to another venue or a blank canvas). A layout's venue also changes from the layout editor's Properties (nothing selected), and a layout whose venue was deleted says so and offers another. New venue opens the template editor, where the tools draw walls (click the points, double-click to finish), rooms, zones, patio edges, doors and windows (they snap onto the nearest wall), columns, stairs, built-in bars and labels. Pick a wall or room side to type its exact length in any unit (`20 ft`, `12' 6"`, `3.8 m`). Saving is automatic. If a change puts a wall through a table, the editor lists each layout and table, and those layouts outline the table in red.

Import plan takes a PNG, JPG or PDF. A PDF drawn with lines keeps its own lines as the walls; a picture or a scan is read by the AI model. The draft opens over the faded original, with anything the model was unsure of marked in amber. Check the scale (confirm the labelled line, take the labels that agree when some disagree, or click two points and type the real distance, which draws the draft again at that scale), then Accept. Nothing changes in the venue before Accept, and Undo import in the Revisions tab puts back what was there before, at any later time. If someone saved the venue meanwhile, Accept asks before it goes over their version. The original stays on a hidden layer (Plan image tab), which also runs the import again on the stored picture (a plan read from a PDF's own lines is run again by importing the PDF).

The import calls the Anthropic API from the server with `ANTHROPIC_API_KEY`, using `claude-sonnet-5-5` unless `FLOORPLAN_MODEL` names another model. Each import costs a few cents. A failed call is logged on the server with its status, the API's reason and the request id (never the key or the image). The tests only reach a stand-in, so after setting the key, or changing the model or the draft schema, run one real call: `npx tsx --conditions=react-server scripts/check-floorplan-api.ts` (key in the environment).

pdf.js decodes black and white scans (JBIG2, CCITT fax) and JPEG 2000 with WebAssembly files the app serves from `public/pdfjs-wasm`, copied from the pinned `pdfjs-dist`. After changing its version, run `npm run pdfjs:wasm`; a unit test fails until the copies match.

**Toronto Beach Club.** The template exists but is empty: its floor plan and room sizes have not been sent yet, and the layout is not guessed. Once the file is here and `ANTHROPIC_API_KEY` is set on the live site, open the template, import the plan, check the draft against the original and the room sizes, and Accept.

## Deploy

1. In Vercel, import the GitHub repo. `vercel.json` sets the build command. This first deployment fails, because there is no database or password yet. That is expected; step 4 redeploys it.
2. Storage, then Marketplace, then Neon: create a database in **AWS us-east-1** (Vercel runs the app there by default, so queries stay fast) and connect it to **Production only**.
3. Environment Variables for Production: `SITE_PASSWORD`, `AUTH_SECRET` (at least 32 characters: `openssl rand -base64 32`), and from milestone 7 `ANTHROPIC_API_KEY` for the floor plan import (optional `FLOORPLAN_MODEL` to try another Claude model).
4. Redeploy. Production builds check those settings and name any that are missing, apply migrations, build, and fail if the password shows up in the build output. Preview builds skip the database.

Signing out everywhere: change `AUTH_SECRET` (or `SITE_PASSWORD`) in Vercel and redeploy.
