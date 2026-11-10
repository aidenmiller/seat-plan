# Seat Plan

Guest list and seating planner for Noa and Aiden's wedding: an overhead floor plan of the venue where you place tables and fixtures, drag guests onto seats, and check seating rules. See `docs/SPEC.md` for the brief, `PLAN.md` for how it is built and `DECISIONS.md` for choices the brief left open.

Next.js 16 (App Router, TypeScript), Postgres with Drizzle, Tailwind, Vitest and Playwright. Hosted on Vercel with Neon.

## What it does

- **One shared password** for the whole site, a 30 day cookie, and Log out. Search engines are told to skip it.
- **Weddings and layouts.** Each wedding holds its guests, groups and rules, and any number of reception or ceremony layouts. Rename in place, duplicate, and delete after typing `delete`.
- **The plan editor.** Pan and zoom from 10% to 800%, a grid in feet or meters, tables and fixtures from the shape panel, handles to move, resize and turn them, align and distribute, undo and redo. Edit mode on laptops, View mode on phones, and a bottom sheet on phones.
- **Seating.** Drag a name onto a seat or table, or tap the + on an empty seat. Names, initials or circles only, depending on the zoom. Search pans to a guest's seat.
- **Guests.** CSV import with column matching and a re-import summary, paste a list of names, edit in place, export as CSV.
- **Rules and groups.** Together and apart rules, couple rules from partner links, red badges and a Problems list. Group highlights and closeness scores.
- **Space check.** The gap to the nearest table while dragging, a warning under 5 ft, and a Room panel with seats against guests.
- **Venues.** A template editor for walls, rooms, doors and windows, and a floor plan import that turns a PDF or picture into walls (see below).
- **Ceremony layouts.** The seating block tool, chair rows, reserved rows and ceremony fixtures.
- **Notes.** Sticky notes, text, arrows, lines, boxes and circles, each with its author, on their own layer, with a Notes tab.
- **Saving.** Every change saves on its own, kept on the device until the server has it, and a save over someone else's newer version asks first.
- **Exports, backup and share links** (see below).

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
| `npm run seed` | Demo data: "Demo wedding" with three reception layouts, "Reception plan A" (blank canvas, five round tables), "Canvas tour" (blank canvas, one of every table preset and fixture) and "Beach Club reception" (Toronto Beach Club). Its guest list (`scripts/demo-guests.ts`, made up from a fixed random seed): 120 guests in households, a few with accents, on Noa's side, Aiden's or both, mostly RSVP yes with some pending and a few no, 10 children, some meals and notes; 8 groups with their members; 20 couples linked as partners; 5 rules (shown from milestone 6). About 80 of them sit at the tables of "Reception plan A" and "Canvas tour" (the sweetheart table stays free). "Canvas tour" also gets a few notes by Noa and Aiden (`scripts/demo-notes.ts`), one marked done, and an arrow attached to the bar and table 3. A fourth layout, "Ceremony", is a ceremony layout on a blank canvas: the seating block tool's 8 rows of 6 each side of the aisle, the chuppah, officiant and musicians in front, row 1 on Noa's side reserved as "Family, row 1", and a few of Aiden's family seated by name on row 1 of his side. "Canvas tour" also gets a share link labelled "Caterer", with names and notes on; its password is made up at random and not shown, so set one with Change password in the wedding's Links tab before you try it. Safe to run twice: guests match by name, and groups, couples, rules, seats, notes and the share link are only added where none are yet. It runs tsx with the `react-server` condition, so it writes through the app's own server code. |
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

## Exports, backup and share links

Export opens from the editor's top bar on a laptop, from the canvas menu (right click, or a long press on an empty part of the plan) on a phone or a laptop, and from each card on the Layouts tab. From the editor it prints the plan as it is on screen, saved or not; from the Layouts tab it prints the last saved version. Files are made in the browser.

- Floor plan as PDF or SVG: full names, initials or tables only, notes in or out, Letter or Tabloid, landscape. Names never print under 6 pt; when Letter would shorten them, the dialog suggests Tabloid or initials. The PDF embeds Noto Sans (`public/fonts`, with its license), so accented names print as typed.
- Table list for the venue, each table with its guests and their meals, as PDF and CSV. Guest notes are left out.
- Escort cards: every seated guest by last name with their table, as PDF and CSV (row and chair in a ceremony layout).
- Ceremony list: reserved rows and named seats, as PDF.

CSV files start with a byte order mark so Excel reads accents, and a cell starting with `=`, `+`, `-` or `@` is guarded so a spreadsheet never runs it.

Wedding settings has Download backup: one JSON file with the guests, groups, rules, layouts and the venues they use, floor plan images included. Restore from file on the home screen checks the file and makes a new wedding, "Name (restored)", in steps (rows, then each venue and its image, then each layout), showing each step; if one fails, Try again picks up where it stopped. A venue that still has the same walls is reused, otherwise it comes back as "Name (restored)". Share links are not in the backup.

Share in the layout editor makes a view-only link for the venue, with its own password and switches for guest names and notes. The wedding's Links tab lists the links that are on, when each was last opened, and lets you change a link's password, switch names or notes, or turn it off; a new password or turning it off signs out anyone using it. The link's page asks for its password; the site password opens every link too. After the password the venue sees that one layout in View mode, with the wedding's and the layout's names: pan, zoom, search a guest, and tap a seat for the guest's name, meal and Child flag (never their notes). With names off, seats show no names or initials and the search goes. Nothing else of the wedding is reachable. The open page checks the link every 60 seconds and whenever it regains focus, so a new password or turning the link off signs the viewer out within a minute.

## Deploy

1. In Vercel, import the GitHub repo. `vercel.json` sets the build command. This first deployment fails, because there is no database or password yet. That is expected; step 4 redeploys it.
2. Storage, then Marketplace, then Neon: create a database in **AWS us-east-1** (Vercel runs the app there by default, so queries stay fast) and connect it to **Production only**.
3. Environment Variables for Production: `SITE_PASSWORD`, `AUTH_SECRET` (at least 32 characters: `openssl rand -base64 32`), and from milestone 7 `ANTHROPIC_API_KEY` for the floor plan import (optional `FLOORPLAN_MODEL` to try another Claude model).
4. Redeploy. Production builds check those settings and name any that are missing, apply migrations, build, and fail if the password shows up in the build output. Preview builds skip the database.

Signing out everywhere: change `AUTH_SECRET` (or `SITE_PASSWORD`) in Vercel and redeploy.
