# Something Blueprint.

Guest list and seating planner for weddings: an overhead floor plan of the venue where you place tables and fixtures, drag guests onto seats, and check seating rules. Planners have their own accounts and each wedding has its own members. See `docs/SPEC.md` for the brief, `PLAN.md` for how it is built and `DECISIONS.md` for choices the brief left open.

It was called Seat Plan. The repository, the npm package and the stored identifiers (the backup format, browser storage keys, cookie names) keep the `seat-plan` name. The brand's artwork and name are in `src/brand/`, its colors in `src/app/globals.css` and its fonts in `src/app/fonts/`.

Next.js 16 (App Router, TypeScript), Postgres with Drizzle, Tailwind, Vitest and Playwright. Hosted on Vercel with Neon.

## What it does

- **Accounts and people.** Everyone signs in with their own email and password. A wedding has owners and editors, and people join by one-time invite links; anyone who is not a member gets "Not found". An admin can open any wedding. See "Accounts, people and the admin area" below. Search engines are told to skip the site.
- **Weddings and layouts.** Each wedding holds its guests, groups and rules, and any number of reception or ceremony layouts, and has two optional partner names that label the guests' sides. Rename in place, duplicate, and delete after typing `delete`.
- **The plan editor.** Pan and zoom from 10% to 800%, a grid in feet or meters, tables and fixtures from the shape panel, handles to move, resize and turn them, align and distribute, undo and redo. Edit mode on laptops, View mode on phones, and a bottom sheet on phones.
- **Seating.** Drag a name onto a seat or table, or tap the + on an empty seat. Names, initials or circles only, depending on the zoom. Search pans to a guest's seat.
- **Guests.** CSV import with column matching and a re-import summary, paste a list of names, edit in place, export as CSV. A guest's side is Partner 1, Partner 2 or Both, shown as the wedding's two names.
- **Rules and groups.** Together and apart rules, couple rules from partner links, red badges and a Problems list. Group highlights and closeness scores.
- **Space check.** The gap to the nearest table while dragging, a warning under 5 ft, and a Room panel with seats against guests.
- **Venues.** A shared library of venue templates and private ones of your own, a template editor for walls, rooms, doors and windows, and a floor plan import that turns a PDF or picture into walls (see below).
- **Ceremony layouts.** The seating block tool, chair rows, reserved rows and ceremony fixtures.
- **Notes.** Sticky notes, text, arrows, lines, boxes and circles, each with its author, on their own layer, with a Notes tab.
- **Saving.** Every change saves on its own, under the signed-in account, kept on the device (in that person's own storage) until the server has it, and a save over someone else's newer version asks first.
- **Exports, backups and share links** (see below).

## Run it on your laptop

You need Node 22 and a Postgres 16 server.

1. Make a database, for example:
   ```bash
   createdb seating_dev
   ```
2. Copy `env.example` to `.env.local` and fill in `DATABASE_URL`, `AUTH_SECRET` (at least 32 characters: `openssl rand -base64 32`) and `SITE_PASSWORD` (any password; it only opens first-run setup). Keep `BACKUP_STORE_DIR=.backups` if you want stored backups on your laptop; without it they are off. The floor plan import also needs `ANTHROPIC_API_KEY`; without it everything else works and the import says the key is missing.
3. Install, migrate and start:
   ```bash
   npm install
   npm run db:migrate
   npm run dev
   ```
4. Open http://localhost:3000/setup, type the `SITE_PASSWORD` and make the first account (any email locally). It is an admin and the owner of any weddings already in the database. After that, sign in at http://localhost:3000 with that email and password. `/setup` then answers "Not found" and `SITE_PASSWORD` is no longer used.
5. Optional demo data, once that account exists: `npm run seed` (and `npm run seed:perf` for the speed test's layout). Both give their weddings to the first admin as owner and stop with a message if there is no account yet.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build`, `npm start` | Production build and server |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm test` | Vitest: unit tests and database tests (needs `seating_test`, see below). `npm run test:unit` and `npm run test:int` run each half. |
| `npm run e2e` | Playwright on a production build, at 1440 px and 390 px with touch (needs `seating_e2e`). A run makes its own three accounts, an admin and two planners, with passwords made up for that run. `E2E_SKIP_BUILD=1` reuses the last build. The speed test (`e2e/perf.spec.ts`) runs in the 1440 px project only. The floor plan import tests talk to a stand-in for the Anthropic API that the run starts on port 4210 (`e2e/stand-in-anthropic.ts`; `E2E_STAND_IN_PORT` picks another), so they need no key and never reach the real API. |
| `npm run db:generate` | Make a migration from changes to `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL_UNPOOLED`, else `DATABASE_URL` (the seed uses the same order) |
| `npm run seed` | Demo data, owned by the first admin (make that account at `/setup` first): "Demo wedding" (partner names Noa and Aiden) with three reception layouts, "Reception plan A" (blank canvas, five round tables), "Canvas tour" (blank canvas, one of every table preset and fixture) and "Beach Club reception" (Toronto Beach Club). Its guest list (`scripts/demo-guests.ts`, made up from a fixed random seed): 120 guests in households, a few with accents, on Noa's side, Aiden's or both, mostly RSVP yes with some pending and a few no, 10 children, some meals and notes; 8 groups with their members; 20 couples linked as partners; 5 rules (shown from milestone 6). About 80 of them sit at the tables of "Reception plan A" and "Canvas tour" (the sweetheart table stays free). "Canvas tour" also gets a few notes written as that admin (`scripts/demo-notes.ts`), one marked done, and an arrow attached to the bar and table 3. A fourth layout, "Ceremony", is a ceremony layout on a blank canvas: the seating block tool's 8 rows of 6 each side of the aisle, the chuppah, officiant and musicians in front, row 1 on Noa's side reserved as "Family, row 1", and a few of Aiden's family seated by name on row 1 of his side. "Canvas tour" also gets a share link labelled "Caterer", with names and notes on; its password is made up at random and not shown, so set one with Change password in the wedding's Links tab before you try it. Safe to run twice: guests match by name, and groups, couples, rules, seats, notes and the share link are only added where none are yet. It runs tsx with the `react-server` condition, so it writes through the app's own server code. |
| `npm run seed:perf` | The speed test's layout, for trying pan and zoom by hand on a phone or laptop (it also needs the first admin): a "Speed test" wedding with 400 made-up guests and one layout, "40 tables" (40 round tables of 10 seats, every seat taken, and 100 shapes). Safe to run twice. |
| `npm run check:secrets` | Fails if `AUTH_SECRET`, or the site password, `CRON_SECRET` or `BLOB_READ_WRITE_TOKEN` when set, is in the built browser files or in git history |
| `npm run vercel-build` | What Vercel runs: on Production it checks the settings (and names any that are missing), applies migrations, builds and runs the secret check; on other deployments it skips migrations |
| `npm run db:reset-test` | Empties a local test database |
| `npm run pdfjs:wasm` | Copies pdf.js's WebAssembly files into `public/pdfjs-wasm` (see below) |
| `npx tsx scripts/create-test-dbs.ts [suffix]` | Makes the local test databases and applies migrations |

Tests use local databases only and refuse any other host. Create them once:

```bash
createdb seating_test
createdb seating_e2e
```

They default to `postgres://seating:seating@127.0.0.1:5432/...`; set `TEST_DATABASE_URL` and `E2E_DATABASE_URL` to use others. Several checkouts can run tests at once: `npx tsx scripts/create-test-dbs.ts b` makes `seating_test_b` and `seating_e2e_b`, and `TEST_DB_SUFFIX=_b` (with `E2E_PORT` and `E2E_STAND_IN_PORT` set to free ports) points a run at them. Playwright makes up fresh passwords for its accounts each run, so tests never hold a real one.

## Accounts, people and the admin area

**Signing in.** Everyone has their own account: an email and a password of 10 or more characters. A session lasts 30 days from its last use and a year at most, and Log out ends it. The Account page changes your name and password (which signs your other devices out) and lists where you are signed in. Edits and notes are recorded under the account that made them.

**No open sign-up.** The first account is made once, at `/setup`, with `SITE_PASSWORD` (on Vercel also the `BOOTSTRAP_ADMIN_EMAIL` address). It becomes the admin and the owner of every wedding that already exists. After that `/setup` answers "Not found" for good and `SITE_PASSWORD` is unused. Everyone else joins by invite. The app has no screen for making a second admin.

**Invites.** An owner makes an invite from the wedding's People tab, as owner or editor. An admin makes a new-planner invite in Admin, then People: that person gets an account and starts their own weddings. The app sends no email: copy the link and send it yourself. An invite is shown once, works once, lasts 7 days and can be locked to one email. Its secret sits after the `#` in the address, which browsers never send to the server. Someone who already has an account opens the link while signed in to join.

**Password resets.** Only an admin can make a reset link, in Admin, then People, for anyone. It works once and lasts 24 hours; using it sets a new password and signs that person out everywhere.

**Roles in a wedding.**

| | Owner | Editor |
|---|---|---|
| Plans, guests, groups, rules, notes, CSV import, exports | Yes | Yes |
| Delete a layout; see who belongs and the share links | Yes | Yes |
| Leave the wedding | Yes, unless the only owner | Yes |
| Settings (name, date, unit, minimum gap, partner names) and deleting the wedding | Yes | No |
| People: invite, change a role, remove someone | Yes | No |
| Make, change or turn off share links | Yes | No |
| Download a backup, saved backups, back up now, restore | Yes | No |

A wedding always keeps at least one owner. Someone who is not a member gets "Not found" for the wedding and everything in it, whatever they ask for; a member who asks for more than their role allows is told they may not. Anyone signed in can start a wedding of their own or restore a backup file.

**Admins.** An admin can open and change any wedding or venue, as an owner would. Each visit is logged, and a wedding the admin is not a member of shows an "Admin view" banner. The admin area has five tabs: Overview (counts of people, weddings, guests, layouts, venues and share links on, and edits and sign-ins by day), Weddings (every wedding, deleted ones too: add a member, transfer ownership, claim one that has no owner, undelete), People (turn an account off or on, Sign out everywhere, make a reset link, new-planner invites and each planner's AI imports), Venues (library membership and owner) and Backups (see below).

**Partner names.** Each wedding has two optional names, set in its Settings. A guest's side is stored as Partner 1, Partner 2 or Both and shown as those names ("Partner 1" and "Partner 2" while a name is empty), so renaming a partner relabels every guest. The CSV side column holds the names, and an import also reads "Partner 1", "P1", "Both" and the names with `'s` or "side" ("Sam's side"). The ceremony seating block labels its sides "<name>'s side".

## Venues and the floor plan import

A venue is in the shared library (every planner can read and copy it; only an admin changes it) or is a planner's own, private to them. A wedding's Venues tab lists the library, your own venues and the venues that wedding's layouts use. Someone else's venue that a layout of yours uses is read-only to you, and a venue nobody in your weddings uses is not there. "Make my own copy" copies any venue you can read into a private one you can edit. Your own venues have rename, Duplicate and Delete (blocked while a layout uses the venue; the dialog lists those layouts, each with Change venue to move it to another venue or a blank canvas). Admins change the library, and which venues are in it and who owns each, in Admin, then Venues. A layout's venue also changes from the layout editor's Properties (nothing selected), and a layout whose venue was deleted says so and offers another. New venue opens the template editor, where the tools draw walls (click the points, double-click to finish), rooms, zones, patio edges, doors and windows (they snap onto the nearest wall), columns, stairs, built-in bars and labels. Pick a wall or room side to type its exact length in any unit (`20 ft`, `12' 6"`, `3.8 m`). Saving is automatic. If a change puts a wall through a table, the editor lists each layout and table, and those layouts outline the table in red.

Import plan takes a PNG, JPG or PDF. A PDF drawn with lines keeps its own lines as the walls; a picture or a scan is read by the AI model. The draft opens over the faded original, with anything the model was unsure of marked in amber. Check the scale (confirm the labelled line, take the labels that agree when some disagree, or click two points and type the real distance, which draws the draft again at that scale), then Accept. Nothing changes in the venue before Accept, and Undo import in the Revisions tab puts back what was there before, at any later time. If someone saved the venue meanwhile, Accept asks before it goes over their version. The original stays on a hidden layer (Plan image tab), which also runs the import again on the stored picture (a plan read from a PDF's own lines is run again by importing the PDF).

The import calls the Anthropic API from the server with `ANTHROPIC_API_KEY`, using `claude-sonnet-5-5` unless `FLOORPLAN_MODEL` names another model. Each import costs a few cents. To keep that in hand, each planner may start `AI_IMPORT_MONTHLY_LIMIT` imports in any 30 days (default 10; `0` lets only admins import; admins are never capped); past that the import dialog says so. Admin, then People shows each planner's imports for the last 30 days. A failed call is logged on the server with its status, the API's reason and the request id (never the key or the image). The tests only reach a stand-in, so after setting the key, or changing the model or the draft schema, run one real call: `npx tsx --conditions=react-server scripts/check-floorplan-api.ts` (key in the environment).

pdf.js decodes black and white scans (JBIG2, CCITT fax) and JPEG 2000 with WebAssembly files the app serves from `public/pdfjs-wasm`, copied from the pinned `pdfjs-dist`. After changing its version, run `npm run pdfjs:wasm`; a unit test fails until the copies match.

**Toronto Beach Club.** The template is in the library, filled by migration `0004_toronto_beach_club_fixed_items.sql`: a tracing of the venue's marketing floor plan (163 items), scaled from the Mediterranean Room's stated 3,500 sq ft. 69 items are marked unsure and show in amber. It is not a survey: check the walls, doors and room sizes against the venue's own plan and fix what differs. The migration only fills the template while it is empty, so it never overwrites edits.

**Liberty Grand – Governor's Room.** Migration `0008_liberty_grand_governors_room.sql` adds this to the shared library (it has no owner). It is approximate: drawn from the venue's published sizes (172 × 61 ft), not from a survey. No item is flagged as unsure, so nothing shows in amber; door, window, bar and staircase positions are best readings of the published plans. The source is `scripts/venue-templates/liberty-grand-governors-room.json`; after editing it, rebuild the migration with `npx tsx scripts/build-template-migration.ts scripts/venue-templates/liberty-grand-governors-room.json drizzle/0008_liberty_grand_governors_room.sql` (the integration test fails if they differ). To refine it, sign in as the admin and open it from Admin, then Venues. Optionally upload the venue's PDF plan as the reference image and set the scale from the room's 172 ft length. Move any item that turns out to be elsewhere. A planner who is not the admin uses "Make my own copy" first. Two things to confirm with the venue: the 24 ft strip on the courtyard side (the to-scale plan shades only about 37 ft of the 61 ft width, so the strip is assumed to be a gallery under the mezzanine, and tables may not be allowed there), and where the dance floor goes (the published plan has a dashed area of about 31 × 29 ft, probably a dance floor, about 58 to 90 ft from the south-west end against the gallery line; it is not in the template because dance floors belong to each layout).

## Exports, backups and share links

Export opens from the editor's top bar on a laptop, from the canvas menu (right click, or a long press on an empty part of the plan) on a phone or a laptop, and from each card on the Layouts tab. From the editor it prints the plan as it is on screen, saved or not; from the Layouts tab it prints the last saved version. Files are made in the browser.

- Floor plan as PDF or SVG: full names, initials or tables only, notes in or out, Letter or Tabloid, landscape. Names never print under 6 pt; when Letter would shorten them, the dialog suggests Tabloid or initials. The PDF embeds Noto Sans (`public/fonts`, with its license), so accented names print as typed.
- Table list for the venue, each table with its guests and their meals, as PDF and CSV. Guest notes are left out.
- Escort cards: every seated guest by last name with their table, as PDF and CSV (row and chair in a ceremony layout).
- Ceremony list: reserved rows and named seats, as PDF.

CSV files start with a byte order mark so Excel reads accents, and a cell starting with `=`, `+`, `-` or `@` is guarded so a spreadsheet never runs it.

Wedding settings (owners) has Download backup: one JSON file with the guests, groups, rules, layouts, members and the venues they use, floor plan images included. The file's format is `seat-plan-backup`, version 2; version 1 files (from before partner names) still restore, as Noa and Aiden's wedding. Restore from file on the home screen checks the file and makes a new wedding, "Name (restored)", in steps (rows, then each venue and its image, then each layout), showing each step; if one fails, Try again picks up where it stopped. A venue that still has the same walls is reused, otherwise it comes back as "Name (restored)". Share links are not in the backup.

**Stored backups.** As well as the file you download, the site saves backups itself. At 08:00 UTC each night Vercel calls `/api/cron/backups` with the cron secret (on the Hobby plan it runs at some point in that hour). Each wedding that changed since its last backup is saved, gzipped, to the private Blob store (`backups/w/<wedding id>/...`); floor plan images are stored once each by content (`backups/images/<sha256>`). A wedding that did not change is not saved again. A deleted wedding gets one last backup. Backups are kept for 30 days, then the first of each month for 12 months, and the newest backup of every wedding is always kept (a deleted wedding's last one for 12 months). The job never lists the store and holds itself to 1,500 uploads in any 30 days, because the Hobby plan allows 2,000 Blob "advanced operations" a month (browsing the store in the Vercel dashboard counts too) and locks the store for 30 days past that. Locally, `BACKUP_STORE_DIR=.backups` keeps backups in a folder; without it, backups are off. Owners see a wedding's saved backups in its Settings (Back up now, Download, Restore as a new wedding); admins see every run and backup in Admin, then Backups, and can run the job at once. Restoring a stored backup makes a new wedding, "Name (restored)", owned by whoever restores it; when an admin restores someone else's wedding, its current owners are made owners too.

Share in the layout editor makes a view-only link for the venue, with its own password and switches for guest names and notes. The wedding's Links tab lists the links that are on, when each was last opened, and lets you change a link's password, switch names or notes, or turn it off; a new password or turning it off signs out anyone using it. The link's page asks for its password; anyone signed in who belongs to the wedding (or an admin) can open it without one, and that does not count as the venue opening it. After the password the venue sees that one layout in View mode, with the wedding's and the layout's names: pan, zoom, search a guest, and tap a seat for the guest's name, meal and Child flag (never their notes). With names off, seats show no names or initials and the search goes. Nothing else of the wedding is reachable. The open page checks the link every 60 seconds and whenever it regains focus, so a new password or turning the link off signs the viewer out within a minute.

## Deploy

### First deployment of a new site

1. In Vercel, import the GitHub repo. `vercel.json` sets the build command and the nightly backup cron. This first deployment fails, because there is no database or secret yet. That is expected; step 5 redeploys it.
2. Storage, then Marketplace, then Neon: create a database in **AWS us-east-1** (Vercel runs the app there by default, so queries stay fast) and connect it to **Production only**.
3. Storage, then Create Storage, then **Blob**: set its access to **Private**, and connect it to **Production** (this adds `BLOB_STORE_ID`; the app signs in to it through Vercel's OIDC, so no token is needed). Nightly backups go there.
4. Environment Variables for Production: `AUTH_SECRET` (at least 32 characters: `openssl rand -base64 32`), `CRON_SECRET` (at least 32 letters and digits, nothing else: `openssl rand -hex 32`; paste it without spaces or line breaks), `SITE_PASSWORD` and `BOOTSTRAP_ADMIN_EMAIL` (the email the first account must use; both only until setup is done), and `ANTHROPIC_API_KEY` for the floor plan import (optional `FLOORPLAN_MODEL` to try another Claude model, `AI_IMPORT_MONTHLY_LIMIT` to change the cap). Do not set `BACKUP_STORE_DIR` on Vercel.
5. Redeploy. Production builds check those settings and name any that are missing (a production build fails without `AUTH_SECRET`, `DATABASE_URL`, `CRON_SECRET` or a connected Blob store), apply migrations, build, and fail if a secret shows up in the build output. Preview builds skip the database.
6. Open `/setup` on the live site, type `SITE_PASSWORD` and make the first account with the `BOOTSTRAP_ADMIN_EMAIL` address. Every Vercel deployment, previews included, refuses setup without `BOOTSTRAP_ADMIN_EMAIL` and refuses any other email, so a preview pointed at an empty database cannot be claimed by someone who knows the password. Setup closes for good once an account exists.
7. Check the nightly backup (see the last step below), then remove `SITE_PASSWORD` and `BOOTSTRAP_ADMIN_EMAIL`.

### Going live with this version

For a site that already runs the single-password version (one shared password, Noa and Aiden's wedding). Do these in order.

1. **Back up first.** On each wedding's Settings, Download backup, and keep the files. Then snapshot the database (a Neon branch or an export). The migrations in this version add tables and columns, give every wedding the partner names Noa and Aiden, and convert guests' sides; restoring the snapshot is the way back, and there is no automatic one.
2. **Prepare Vercel.** Create a **private** Blob store and connect it to **Production**. Add `CRON_SECRET` (letters and digits, 32 or more) and `BOOTSTRAP_ADMIN_EMAIL` (the email you will use for the first account) to Production. **Keep `SITE_PASSWORD`** for now: setup needs it. **Do not change `AUTH_SECRET`**: link viewers stay signed in because their cookies are keyed to it.
3. **Deploy.** Merge to `main`. The production build checks the new settings, applies migrations 0005 to 0009 and builds. The old password page is gone: everyone, you included, signs in with an account from now on, and anyone with the old cookie is sent to the sign-in page.
4. **Make the admin.** Open `/setup`, type `SITE_PASSWORD` and make your account with the `BOOTSTRAP_ADMIN_EMAIL` address. You become an admin and the **owner of every existing wedding**.
5. **Invite the co-owner.** On each existing wedding's People tab, make an invite as **owner** and send the link. One link is for one wedding: they make an account with the first and open the others while signed in.
6. **Invite any new planner** in Admin, then People, with a new-planner invite. They start their own weddings and cannot see yours.
7. **Confirm the nightly backup.** After 08:00 UTC the next day (or at once, with Run now on Admin, then Backups), the page should show a run with its weddings backed up. In Vercel, Schedules, then the Cron Jobs tab, lists `/api/cron/backups` at `0 8 * * *`, and View Logs should show the call answering 200 with counts such as `"backedUp": 1`. A 401 means the deployment's `CRON_SECRET` is missing or differs (it is read when a deployment is built: redeploy after changing it); a 503 means no Blob store is connected to Production.
8. **Remove `SITE_PASSWORD`** from Production and redeploy. Nothing reads it after setup. `BOOTSTRAP_ADMIN_EMAIL` can go with it.

**What cannot be checked before the first deploy.** The tests keep stored backups in a folder and call the cron route directly, so real Vercel Blob storage and the real nightly trigger run for the first time on the live site: step 7 is that check. Look at the first run's result before relying on it. Also check, against Vercel's and Neon's current terms: Vercel's Hobby plan is for non-commercial use and caps Blob storage (the backup job holds itself to 1,500 uploads in any 30 days because of the 2,000 operations a month the Hobby plan includes), and Neon's free plan keeps only a short window of point-in-time history (a few hours at the time of writing), so it is no substitute for the stored backups or for the snapshot in step 1.

**Signing people out.** Admin, then People, then Sign out everywhere ends one person's sessions. Changing `AUTH_SECRET` and redeploying signs out everyone and every share link viewer; do not do that while going live.
