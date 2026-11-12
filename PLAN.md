# Wedding Seating Planner: Build Plan

Draft for review, 2026-11-09. The spec is in `docs/SPEC.md`, a copy of the brief with the site password removed. This plan says how I will build the app, what I suggest changing, and what I need from you. I will not write app code until you approve it.

Contents

1. What I need from you
2. Changes I suggest to the spec, and open questions
3. Stack and versions
4. Data model
5. Server: pages, routes, auth, saving
6. Canvas editor
7. Other features
8. Folder layout
9. Tests, with every acceptance check mapped
10. Milestones and how each one ships
11. Deploy steps for you

---

## 1. What I need from you

These block a milestone. Everything else has a default in section 2 or in `DECISIONS.md`.

| # | What | Needed by | Why |
|---|------|-----------|-----|
| A | Push access to `aidenmiller/seat-plan` for this session: connect that GitHub account at claude.ai/connect-github and install the Claude GitHub App on the repo. | End of milestone 1 | The repo exists, but this session cannot push to it yet. Until it can, the work stays in this sandbox and is lost when the sandbox closes. |
| B | About five minutes in Vercel: import the repo, add Neon from the Marketplace, set three env vars (section 11). | End of milestone 1 | This sandbox cannot reach vercel.com, neon.tech or `*.vercel.app`, so I can neither deploy nor open the live site. You confirm what you see. |
| C | An Anthropic API key, saved as `ANTHROPIC_API_KEY` in Vercel. | Milestone 7 | The floor plan import calls the API from the server. Tests use a recorded reply, so only the live import needs the key. |
| D | The Toronto Beach Club floor plan (PDF if you have it, else PNG or JPG) and its room sizes. | Milestone 7 | The spec says to run it through the import and not guess. Until then the seed makes an empty template with that name. |
| E | Answers to the open questions at the end of section 2. Each has a default, so no answer means the default. | The milestone named in each question | |

---

## 2. Changes I suggest to the spec, and open questions

Each item says what changes and why. Approving the plan approves these. Strike any you disagree with.

**Data and saving**

1. **Keep zoom, pan and layer switches in each device's browser storage.** The spec stores `view` and the layer visible and locked switches in the layout's saved canvas. Every pan or layer toggle would then change the canvas, trigger a save and raise the layout's version. If Noa pans while Aiden edits, her save raises the version, Aiden's next save still carries the old one, and he gets a conflict dialog although Noa changed nothing on the plan. With the view kept per device and per layout, each layout still reopens where that person left it.
2. **Store seats in the canvas and also in a checked copy the database guards.** The canvas JSON stays the one true record of who sits where, so undo, the offline queue, duplicate and backup all handle one document. On every save the server also rebuilds a `layout_seats` table (layout, guest, table, seat) in the same transaction. A primary key on (layout, guest) means the database itself refuses a guest in two seats of one layout. The table also tells the server which layouts a guest removal touches, without opening every canvas. A future solver would write seats through the normal save, like a person.
3. **Tables get a number separate from their name.** Escort cards and table lists print a table number. If you rename "Table 3" to "Family", it keeps number 3. A new, pasted or duplicated table takes the highest number in the layout plus one. You can edit the number, and the panel warns if two tables share one. The default name "Table N" follows the number until you rename the table.
4. **Round tables use 22 inches of edge per seat; straight edges keep 24.** The spec's own presets break its 24 inch rule: a 60 in round with 8 seats gives 23.6 in per seat, so every new round table would show the yellow outline, and Fit seats would drop it to 7. Chairs at a round table fan outward, so caterers seat round tables tighter. At 22 in, a 48 in round holds 6, a 60 in round holds 8 and a 72 in round holds 10, which are the usual counts. Straight edges keep exactly 24 in (60.96 cm; the spec rounds this to 61) with a 0.5 cm allowance, so a 48 in square holds 8 and a 24 ft one-sided table holds exactly 12. Lengths are stored as decimals, so 24 ft stays 731.52 cm and Fit seats never loses a seat to rounding.
5. **Venue templates are shared by all weddings.** The spec's sketch gives templates no wedding id, and a venue does not belong to one wedding. If each wedding had its own copy, the Toronto Beach Club work would not carry over to a wedding you create later. Every wedding's Venues tab shows the same list. A backup includes the templates its layouts use. A restore reuses a template only if it still exists and its walls match the backup; otherwise it recreates it as "Name (restored)".
6. **Keep the floor plan image in Postgres, behind the password gate.** Vercel refuses request bodies over 4.5 MB, so the browser shrinks the upload to at most 2,576 px on the long edge and about 3 MB, and turns a PDF page into a PNG. An image that size fits in a Postgres row, the app serves it only to signed-in users, and the app needs no second storage service or extra secret. The same image goes to the AI import and onto the hidden reference layer.
7. **Removing a guest never causes a save conflict.** In one transaction the server marks the guest deleted, clears their seats in every layout, and clears their partner link. It leaves those layouts' version numbers alone. Because the versions stay the same, someone who has one of those layouts open can still save: their save carries the current version, the server drops any seat held by a removed guest, and the reply names those guests so the editor unseats them on screen. A rule left with fewer than two live guests shows on the Rules page as "needs guests" and is not checked.
8. **The app works out couple rules from partner links and stores no rule rows for them.** Each guest has a "couple rule on" switch, kept the same on both partners. The rules list shows a couple rule for every linked pair, and switching it off flips the switch on both people. A couple rule then always matches the partner links. Linking A to B clears any earlier partner of either, and turns the switch back on for both.
9. **Copied, pasted and duplicated tables come with every seat empty.** Copying the guests too would put each of them in two seats, which the one-seat rule forbids. Duplicating a whole layout keeps the guests, as the spec says.
10. **Re-import matches on a guest id first.** The guest CSV export adds a `guest_id` column. Re-import matches each row on that id first, then on first and last name, ignoring case and accents. A row whose name matches two or more guests waits in a "needs review" list with a picker, and the app applies it only after you pick. A blank cell leaves the field as it was. Re-import adds each guest to the groups the file lists and takes no one out of any group. Re-import adds an unknown column's value to a guest's notes only when the notes do not already hold that line, so importing the same file twice reports no changes.

**Editor**

11. **Mouse wheel or trackpad.** Browsers report a mouse wheel and a two-finger trackpad scroll as the same event. A mouse wheel moves in a few large, even steps and a trackpad in many small ones, so I will tell them apart by step size: the wheel zooms and the trackpad pans, as the spec says. That works for most mice. For the rest, a setting "Mouse wheel: zoom / pan" lets you choose.
12. **One finger on empty canvas pans on phones, in both modes.** The spec makes a drag on empty canvas draw a selection box, which would leave a phone in Edit mode no way to pan with one finger. So on touch screens one finger pans, and in Edit mode a Select button in the phone toolbar switches one-finger drag to drawing a selection box.
13. **Phones count as phones at any width.** The spec opens View mode on "phones and screens under 768 px wide". A phone held sideways is wider than 768 px, so the app also treats any touch-only device as a phone.
14. **Every Shift or Alt action also gets a button or field.** Phones have no Shift or Alt key, so the properties panel has a Snap switch, a Keep proportions switch and a rotation field, and every selection shows a menu button.
15. **"Next to each other" means an unbroken run of seats on one side.** On a round table, seats in order around the table are neighbors, including the last and the first. On a table seated on all sides, neighbors run around the edge, across corners too. On a no-ends table, each long side is its own run, so the two seats facing each other across an end are not neighbors. A one-sided table is one run. A rule with three or more guests passes when they fill one unbroken run. Ceremony rows on opposite sides of the aisle are separate rows (change 18) and never neighbors.
16. **Problems and warnings are counted apart.** The top bar count ("3 seating problems") counts broken rules and tables a wall runs through. Tight tables (yellow), narrow gaps between tables and seated guests who answered no are warnings. They show in the Problems tab under their own heading and never add to the count. A rule clash is flagged when any two guests share both a together rule and an apart rule that apply to the same layout kind.
17. **Names run along the outward line from a straight edge.** The spec puts names on a line out from the table's center. On a long table, that line runs nearly along the table at the end seats, so the end names would pile on top of each other. Round tables keep the spec's rule; on square and rect tables each name runs straight out from its edge.

**Ceremony**

18. **Ceremony rows across the aisle are separate rows.** The seating block tool makes one row item per side, so row 1 on Noa's side and row 1 on Aiden's side are different rows for rules, and a couple split by the aisle shows a problem. Most guests have no ceremony seat, so in ceremony layouts a together rule with fewer than two guests seated by name is hidden, where grey "unfinished" lines would otherwise fill the list.
19. **Closeness scores skip head and sweetheart tables when working out "fewest possible".** Fewest possible fills the largest tables first, so a 12-seat head table would otherwise count as room for 12 friends who will never sit there. One-sided tables and tables of 2 seats or fewer are left out of that count. The "11 of 12 seated" count leaves out guests who answered no. With one member seated, tightness and spread show a dash, since there are no pairs to measure.

**AI import**

20. **Use structured outputs where the spec says "tool use or structured outputs".** Current Claude models reject a forced tool choice, so I will set the JSON shape with a JSON schema and check the reply with Zod, as the spec asks.
21. **For a vector PDF, the walls come straight from the PDF and the model only names them.** If the model returned wall coordinates, it would retype lines the PDF already holds exactly: the numbers would drift, and a detailed plan could run past the reply limit and come back cut off. So each cleaned PDF line goes to the model with an id, and the model answers by id (wall, door, window, ignore), plus rooms, labels and anything the lines do not cover. Scanned plans and images have no lines to reuse, so for those the model returns the geometry.
22. **Read the model name from an env var**, `FLOORPLAN_MODEL`, with the spec's model as the default. If the Toronto Beach Club draft misses walls or doors, we can try a larger Claude model without a code change. Each import costs a few cents either way.

**Password gate and share links**

23. **Password gate details.** API requests without a valid cookie get a 401 reply; pages still go to `/login`. The site cookie's signing key comes from both `AUTH_SECRET` and `SITE_PASSWORD`, so a new password makes a new key, old cookies fail the signature check, and everyone signs in again. Ten wrong guesses in 15 minutes from one address block that address for 15 minutes, even for the right password. Fifty wrong guesses in an hour from all addresses together block new sign-ins for 15 minutes; your 30 day cookies keep working through that. Each wrong guess also waits about a second before the reply.
24. **The share view hides annotations unless you turn them on for that link.** Notes on the canvas may hold private comments ("keep Uncle Bob away from the bar"). The venue sees tables, fixtures, the venue layer and, if names are on, guest names, and a tap on a seat shows that guest's meal and child flags, which a caterer needs. The server builds what the share page receives, so hidden parts never reach the viewer's browser at all. The viewer never sees guest notes, groups, rules, the original floor plan image or other layouts. "Table names only" hides every guest name.
25. **A Links tab on each wedding.** The spec asks for a list of every live link. It sits as a sixth wedding tab, next to Venues.
26. **The site password never enters git.** The original brief holds the site password, and an acceptance check says the password must not appear in git history. I will commit the brief as `docs/SPEC.md` with that one value removed. A script fails if it finds the password: the Vercel build runs it on the built browser files, and I run it on git history before every push. It prints where it found a match with the password masked.

**Process**

27. **The Noa / Aiden switch moves from milestone 9 to milestone 2.** Saving needs it from the start: `editedBy`, "last edited by" on the layouts list and the conflict message ("Aiden changed this layout at 3:42 pm") all read it.
28. **Real iPhone checks are yours.** Playwright here can only run Chromium, so the phone tests run Chromium at iPhone size with touch. Every iPhone browser uses Safari's engine, which these tests never run, so at the end of each milestone I will list exactly what to try on your phones.
29. **Milestones ship straight to your live site.** I build each milestone on its own branch, and when its tests pass I merge it into `main`, which Vercel deploys. Neon connects to Production only. Preview builds of other branches then have no database and do nothing, so an unfinished schema change can never reach your data.

**Open questions (default in brackets)**

- Q1, milestone 10. Will any guest names be in Hebrew or another non-Latin script? This decides which fonts the PDF exports embed. [Latin letters only, including accents such as é, ł, ø.]
- Q2, milestone 5. Should a seat label show the nickname instead of the first name when one is set? [No. Nicknames show in search and the hover card.]
- Q3, milestone 3. Check 10 says a rectangle stretched to 24 ft gets "12 seats on one side" after Fit seats. The rectangle preset seats both long sides (4 + 4 at 8 ft), so Fit seats gives 12 on each side, 24 in all. Is that what you meant, or should the table first be switched to one side, for 12 in all? [The test checks both: 12 per side as it stands, and 12 in all after switching to one side.]
- Q4, milestone 7. For a multi-page PDF floor plan, use page 1 or ask? [Ask, with page 1 picked.]
- Q5, milestone 1. Which Vercel plan? Hobby caps a server function at 300 seconds, which is enough for the floor plan import. [Hobby.]
- Advice, milestone 1. The password in the brief is short, easy for friends to guess, and has passed through chat tools. It is the only thing guarding the guest list. Nothing in the code depends on its value, so you can choose a longer one (four random words, say) when you set it in Vercel.

---

## 3. Stack and versions

Checked against npm on 2026-11-08. I pin exact versions in `package.json` and commit the lockfile. Package manager: npm.

| Part | Choice | Notes |
|------|--------|-------|
| App | Next.js 16.4.5, React 19.3, TypeScript 5.9 strict, Node 22 | App Router. The request interceptor is `src/proxy.ts` in this version and runs on Node, so it can use `node:crypto`. TypeScript 7 is the newest on npm, but Next's lint rules do not support it yet. |
| Styles | Tailwind CSS 4.3 with `@tailwindcss/postcss` | |
| Database | Postgres: Neon on Vercel; Postgres 16 in this sandbox and in CI | |
| ORM | drizzle-orm 0.45.4, drizzle-kit 0.31.11 | The stable line. Migrations are generated SQL files checked into `drizzle/`. |
| DB driver | `pg` 8.23 with a pool, plus `attachDatabasePool` from `@vercel/functions` | The only driver that gives real transactions on Vercel and also runs against a plain local Postgres. Neon recommends it for Vercel's current function runtime. |
| Validation | zod 4 | Every request body and the canvas JSON. |
| Editor state | zustand 5.1, immer 11 | Undo and redo written by hand (section 6). |
| Share link passwords | `@node-rs/argon2` (argon2id) | Prebuilt binaries; works on Vercel. |
| Offline queue | idb-keyval 6.3 | |
| CSV | papaparse 5.7 | |
| PDF in | pdfjs-dist 6.5.438, pinned exactly, legacy build | Runs in the browser. Its internal drawing format changed recently, so a unit test guards it. |
| AI | `@anthropic-ai/sdk` 1.6 | Server only. |
| PDF out | jspdf 4.2, svg2pdf.js 2.9, jspdf-autotable 5 | Runs in the browser, loaded only when you export. |
| Fonts | Noto Sans, static Regular and Bold TTF files (open license) | One font for the canvas and the PDFs, so names print with accents. |
| Tests | Vitest 5.1, Playwright 1.65 (Chromium) | |

Left out: tldraw and other licensed whiteboard kits; d3-zoom, because we would have to override every default; drag and drop libraries, because they find drop targets by measuring each element's place on the page, and with 400 SVG seats under a camera that moves every frame those places keep changing and measuring them all is slow; Vercel Blob (change 6).

---

## 4. Data model

All lengths are centimeters, stored as decimal numbers. The UI shows feet and inches (`5′ 6″`, nearest inch) or meters (two decimals), per wedding, and length fields accept `5'6"`, `66in`, `1.7m` or `170cm`.

Every entity table has an `id uuid` (random, made by the app so the browser can create rows offline), `created_at` and `updated_at`. Weddings, layouts, venue templates and guests also have `deleted_at`: deleting one of these marks the row and keeps it, and every query skips marked rows. Deleting a wedding marks only the wedding row; every query also skips rows whose wedding is marked, so clearing that one field brings everything back. Groups and rules are deleted outright, since they are quick to make again.

Rows that belong to a wedding carry `wedding_id`, including the link tables (`group_members`, `rule_guests`, `layout_seats`). Each parent table has a unique key on (`wedding_id`, `id`), and each link points at that pair. The database then refuses to link a guest from one wedding to a partner, group, rule or seat in another.

### Tables

**weddings**
| Column | Type | Notes |
|---|---|---|
| name | text | Not empty (check) |
| date | date, null | |
| unit | text | `ft` or `m`, default `ft` |
| min_gap_cm | real | Default 152.4 (5 ft). The spec's "let us change that number". |

**guests**
| Column | Type | Notes |
|---|---|---|
| wedding_id | uuid | |
| first_name, last_name | text | Not empty |
| nickname, household, meal, notes | text, null | |
| partner_id | uuid, null | Points both ways; the server sets both sides in one transaction. Unique among live guests, and never the guest's own id. |
| couple_rule_enabled | boolean | Default true, kept the same on both partners (change 8) |
| side | text | `Noa`, `Aiden` or `Both`, default `Both` |
| rsvp | text | `yes`, `no` or `pending`, default `pending` |
| is_child | boolean | Default false |
| name_key | text | First and last name in lower case without accents, so "Łukasz" matches "Lukasz". Indexed. Two guests can share a name, so it has no unique constraint. |

**groups**: `wedding_id`, `name` (unique per wedding, ignoring case), `color` (hex).
**group_members**: `wedding_id`, `group_id`, `guest_id`; primary key on group and guest.

**rules**
| Column | Type | Notes |
|---|---|---|
| wedding_id | uuid | |
| kind | text | `together` or `apart` |
| next_to_each_other | boolean | Only allowed with `together` (check) |
| applies_to | text | `reception`, `ceremony` or `both`, default `both` |
| enabled | boolean | Default true |
| note | text, null | |

**rule_guests**: `wedding_id`, `rule_id`, `guest_id`; primary key on rule and guest. The server requires two or more. Adding a group to a rule copies the group's current members; later group changes leave the rule alone.

Couple rules have no rows (change 8). One pure function returns the wedding's rules plus a couple rule (together, next to each other, both layout kinds) for every linked pair whose switch is on.

**venue_templates** (shared by all weddings)
| Column | Type | Notes |
|---|---|---|
| name | text | Not empty |
| fixed_items | jsonb | Walls, rooms, doors, windows, columns, stairs, bars, patio edges, zones, labels (types below) |
| reference_image_id | uuid → venue_images, null | The current original plan |
| reference | jsonb, null | `{ scaleCmPerPx, offsetX, offsetY, rotation, opacity }`. Whether the layer shows is kept per device, as in change 1. |
| imported_by | text | `hand`, `pdf vectors` or `ai` |
| version, last_save_id, edited_by | | Conflict check, as for layouts |

**venue_images**: `template_id`, `content_type` (PNG or JPEG), `bytes` (bytea, at most about 3 MB), `width`, `height`, `sha256`. An import uploads its image here first; the template points at it only after Accept. Old images stay, so an import can be undone. Served only through an authenticated route.

**venue_template_revisions**: `template_id`, `fixed_items`, `reference_image_id`, `reference`, `reason` (`save` or `import`), `created_at`. One row per save. "Undo import" restores the row from before the import, at any later time.

**layouts**
| Column | Type | Notes |
|---|---|---|
| wedding_id | uuid | |
| name | text | Not empty |
| kind | text | `reception` or `ceremony`; fixed at creation |
| venue_template_id | uuid, null | Null means blank canvas |
| version | integer | Goes up by one on every canvas save. Renames leave it alone. |
| last_save_id | uuid, null | Id of the last save applied, so the server answers "done" to a retried save that already landed |
| edited_by | text, null | `Noa` or `Aiden` |
| canvas | jsonb | Checked with Zod on every save (type below) |
| thumb_svg | text | Small vector preview the server draws from the checked canvas, for the layouts list |

**layout_seats** (rebuilt from the canvas on every canvas write, in the same transaction)
| Column | Type | Notes |
|---|---|---|
| wedding_id, layout_id | uuid | |
| guest_id | uuid | Primary key (layout_id, guest_id) |
| item_id | text | The table or chair row |
| item_label | text | Table number and name, or row label, so summaries can name tables without opening canvases |
| seat_index | integer | Unique (layout_id, item_id, seat_index) |

**share_links**
| Column | Type | Notes |
|---|---|---|
| layout_id | uuid | |
| label | text | "Caterer", "DJ", shown in the Links list |
| token | text | 32 random bytes, base64url, unique |
| password_hash | text | argon2id |
| credential_version | integer | Goes up when you change the password or turn the link off. Each link cookie holds the number from when the viewer signed in, and the server compares it with this column on every request, so either change signs viewers out. |
| show_names, show_notes | boolean | Defaults true and false |
| last_opened_at, revoked_at | timestamptz, null | |

**login_attempts**: `scope` (`site` or `share:<linkId>`), `ip_key` (the address hashed with `AUTH_SECRET`; IPv6 addresses by their first 64 bits, since one home controls all of those), `failures`, `window_start`, `blocked_until`. Each server function has its own memory, and a count kept there would miss guesses that reach other functions, so the database keeps the counts.

### Canvas JSON

```ts
type Canvas = {
  schemaVersion: 1
  items: Item[]            // array order is drawing order
}
// Kept per device in browser storage, keyed by layout id (change 1):
type DeviceView = {
  camera: { zoom: number; x: number; y: number }
  layers: Record<'venue' | 'furniture' | 'notes', { visible: boolean; locked: boolean }>
  showReferenceImage: boolean
}

type Seat = { index: number; guestId: string | null; pinned?: boolean }  // pinned: kept for a future solver ("do not move")
type Base = { id: string; x: number; y: number; rotation: number; locked: boolean }  // x, y = center in cm; degrees clockwise

type Table = Base & {
  kind: 'table'; shape: 'round' | 'square' | 'rect'
  width: number; height: number            // round: width === height; every side at least 60.96 (24 in)
  number: number; name: string
  seatCount: number
  seatSides: 'all' | 'noEnds' | 'oneSide'  // oneSide: seats along the back edge, facing the room
  seats: Seat[]                            // length === seatCount
}
type Fixture = Base & {
  kind: 'fixture'
  type: 'food' | 'bar' | 'dj' | 'danceFloor' | 'stage' | 'cake' | 'gifts' | 'photoBooth'
      | 'ceremonyStructure' | 'officiant' | 'aisleRunner' | 'musicians' | 'soundDesk'
      | 'welcomeSign' | 'entrance' | 'custom'
  width: number; height: number; label: string
}
type ChairRow = Base & {
  kind: 'chairRow'; chairCount: number; spacing: number        // spacing default 50.8 cm (20 in)
  blockId: string | null; blockLabel: string | null; rowNumber: number; rowLabel: string
  reservedFor: string | null                                    // "Family, row 1"
  seats: Seat[]
}
type Shape = Base & {
  kind: 'shape'
  type: 'rect' | 'ellipse' | 'line' | 'text' | 'wall' | 'room' | 'door' | 'window'   // walls and rooms are ordinary shapes on a blank canvas
  width: number; height: number; points?: { x: number; y: number }[]
  text?: string; style: { stroke: string; fill: string; strokeWidth: number; fontSize?: number }
}
type Note = Base & {
  kind: 'note'; type: 'sticky' | 'text' | 'arrow' | 'line' | 'box' | 'circle'
  width: number; height: number; points?: { x: number; y: number }[]
  text: string; color: 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'grey'
  author: 'Noa' | 'Aiden'; done: boolean; createdAt: string
  attachedTo: { start: string | null; end: string | null }   // arrows follow tables and fixtures
}
type Item = Table | Fixture | ChairRow | Shape | Note
```

Template fixed items share one type with a `type` field (`wall`, `room`, `door`, `window`, `column`, `stairs`, `bar`, `patioEdge`, `zone`, `label`), geometry in cm, an optional name, and `unsure` with a note for items the AI import was not sure of. Walls are point lists with a thickness. Doors and windows store the wall they sit on, their place along it and their width.

Seat positions are never stored. A pure function works them out from the table's shape, size, seat count and sides, so moving or resizing a table can never leave seats behind.

---

## 5. Server: pages, routes, auth, saving

### Pages

| Path | Page |
|---|---|
| `/login` | Site password |
| `/` | Home: wedding cards |
| `/w/[weddingId]/layouts`, `/guests`, `/groups`, `/rules`, `/venues`, `/links` | Wedding tabs |
| `/w/[weddingId]/layouts/[layoutId]` | Editor |
| `/venues/[templateId]` | Template editor and floor plan import |
| `/share/[token]` | Venue view, or its password page |

### Route handlers

All changes go through route handlers; the app uses no Server Actions. The Next.js docs warn that the proxy alone can miss a route after a refactor, so each handler checks the cookie itself too.

| Method and path | Purpose |
|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout` | Site password |
| `GET, POST /api/weddings`; `GET, PATCH, DELETE /api/weddings/:id` | Weddings, including settings (name, date, unit, minimum gap). DELETE needs `{ confirm: "delete" }`. |
| `GET /api/weddings/:id/delete-summary`, `/api/layouts/:id/delete-summary`, `/api/venues/:id/delete-summary` | What the delete dialog lists. For a template still in use, the layouts that block it. |
| `GET, POST /api/weddings/:id/layouts`; `GET, PUT, PATCH, DELETE /api/layouts/:id` | PUT saves the canvas; PATCH renames or changes the template |
| `GET /api/layouts/:id/version` | Cheap check when the tab regains focus |
| `POST /api/layouts/:id/duplicate` | Also "keep mine as a new copy", with the canvas in the body |
| `GET, POST /api/weddings/:id/guests`; `PATCH, DELETE /api/guests/:id` | One row at a time |
| `POST /api/weddings/:id/guests/import/preview` and `/import/commit` | Re-import summary, then one transaction |
| `POST /api/weddings/:id/guests/bulk` | Pasted names |
| `/api/weddings/:id/groups`, `/api/groups/:id`, `/api/groups/:id/members` | Groups |
| `/api/weddings/:id/rules`, `/api/rules/:id` | Rules |
| `/api/venues`, `/api/venues/:id`, `/api/venues/:id/duplicate`, `/api/venues/:id/revisions` | Templates |
| `POST /api/venues/:id/images`, `GET /api/venues/:id/images/:imageId` | Image upload as raw bytes, and the image itself |
| `POST /api/venues/:id/import` | AI import. Reads the uploaded image by id, streams progress, up to 300 seconds. |
| `GET /api/weddings/:id/share-links`, `GET, POST /api/layouts/:id/share-links`; `PATCH, DELETE /api/share-links/:id` | Share links |
| `POST /share/:token/login`, `GET /share/:token/data` | Share password, and the one layout's view data |
| `GET /api/weddings/:id/backup`, `POST /api/weddings/restore` and `/api/weddings/restore/:jobId/...` | Backup, and restore in steps (section 7) |

### Password gate

- `src/proxy.ts` runs on every path except Next's static files, the font files and `robots.txt`. Crawlers may read pages, so they see the noindex header; a crawler kept out by `robots.txt` never reads that header, and can still list a bare URL that another page links to. It lets through `/login`, `/api/auth/login` and everything under `/share/`. Anything else needs a valid site cookie: a page request goes to `/login?next=...`, an API request gets 401. The `next` value must be a path on this site, so no one can use the login page to send people to another site.
- A unit test fails if any handler under `src/app/api` skips the cookie check, apart from `/api/auth/login`. A second test covers every route under `src/app/share/[token]/` and fails unless it requires the site cookie or that link's cookie, apart from the share login route.
- Login: before comparing, the server adds one to the failure count for this scope and address in a single database statement, and refuses at once if that address or the whole scope is blocked (change 23). It then hashes the typed password and `SITE_PASSWORD` with SHA-256 and compares the hashes with `timingSafeEqual`, which takes the same time whatever the length. A right password clears the count. A wrong one waits about a second before the reply. Counting before comparing means a burst of parallel guesses cannot all slip in before the first failure is written.
- Two cookies, two keys. The site cookie, `site`, holds `{ typ: "site", exp }`, signed with HMAC-SHA256 under a key made from `AUTH_SECRET` and `SITE_PASSWORD`. A share cookie, `share_<linkId>`, holds `{ typ: "share", linkId, credentialVersion, exp }`, signed under a separate key made from `AUTH_SECRET` alone, so changing the site password leaves venue viewers signed in. Each check rejects the wrong `typ`, so a share cookie copied into the site cookie's place fails. All cookies are HttpOnly, Secure and SameSite=Lax and last 30 days. Share cookies use `Path=/share/<token>`, one per link, so two links never overwrite each other.
- `/share/<token>` opens if the site cookie is valid, or if this link's own cookie is valid and names the link found from the token. Either way the server checks on every request that the link is on, its layout and wedding still exist, and the cookie's credential version matches. An unknown token still runs a password check against a dummy hash, so timing does not reveal which tokens exist.
- `X-Robots-Tag: noindex, nofollow` goes on every response, plus a robots meta tag. Share pages also send `Referrer-Policy: no-referrer`, so when a viewer follows a link or the page loads a file from another site, the browser does not send the page address and the token in it.

### Saving layouts

- **Drafts.** Each finished edit (a drag counts once, when you let go) goes into the undo history and straight into IndexedDB, in a draft keyed by layout and tab, in the signed-in user's own database (`seat-plan-u-<userId>`), so the next person on a shared device never sees or sends it. Signing out deletes it (after asking when something is unsaved); a session that merely runs out keeps it. Each tab holds a browser lock named after its tab id for as long as it is open.
- **Sending.** About one second after the last edit, the tab sends `PUT /api/layouts/:id` with the canvas, `baseVersion`, the tab id and a `saveId`. The server records the signed-in user as the editor (their id and display name); no request body names the editor. One save is in flight per tab at a time. The draft records which snapshot and `saveId` are in flight, and every retry resends that same snapshot with that same `saveId`. Edits made meanwhile wait for the next save, which starts from the version the first one returns.
- **Server.** All canvas writes, from saves, duplicates, copies, restores, the seed and guest removal, go through one `writeCanvas()` function. In one transaction it takes a shared per-wedding lock, checks the canvas with Zod, drops seats held by removed or unknown guests and any second seat a guest holds (and lists them in the reply), updates the row only if `version = baseVersion`, rebuilds `layout_seats` and redraws the thumbnail. Guest removal, CSV import and partner changes take the same per-wedding lock in exclusive mode, then lock guests and layouts in id order. A save and a removal can therefore never interleave, and two removals can never deadlock.
- **Answers.** If the version matches, the save lands and the reply gives the new version. If it does not match but this `saveId` is among the layout's 20 most recent saves (kept in `recent_saves`), the save landed earlier and the server says so, with the version that save made. Otherwise the reply is 409 with who saved last and when, and the tab shows "Aiden changed this layout at 3:42 pm" (or "You changed this layout in another tab or on another device", when the save was the same account: told by account id, never by name) with two buttons: Load their version, or Keep mine as a new copy, named "Layout name (Noa's copy)". A 422 (a canvas the server cannot fix) or 410 (the layout or wedding was deleted) stops the retries and shows "Couldn't save" with Save as a copy and Download.
- **Retries.** The top bar shows Saving, Saved, or Not saved, retrying. Retries back off from 1 to 30 seconds and start again when the browser comes back online. The tab sends queued guest, group and rule edits before layout saves, so a guest created offline exists before a seat refers to them.
- **Opening a layout.** The tab looks for drafts of this layout whose tab lock is free, meaning that tab has closed. If the draft's in-flight save is among the server's recent saves, that part already landed: with nothing after it, the tab drops the draft; with later edits, it sends them when that save is still the latest, and otherwise shows the conflict for the later edits only. If the draft started from the server's current version, the tab loads the draft into the editor and saves it. Otherwise it shows the conflict dialog with the draft as "mine".
- **Closing the tab.** While anything is unsaved, the browser warns before closing. When the page hides, the tab also tries one last save with `keepalive` if the body is under 60 KB, since browsers refuse larger `keepalive` requests. Either way IndexedDB holds the edit and the next load sends it. iPhone Safari never shows the closing warning, so on phones this replay alone keeps the edit.
- **Other people's changes.** When a tab regains focus it asks for the layout's version. If the other person saved and this tab has no unsaved edits and no gesture in progress, it loads their version and shows "Loaded Aiden's changes". Whenever the document is replaced from the server, the tab clears its undo and redo history and its draft, so Undo can never put back a snapshot that would wipe their work.
- **Guests, groups and rules** save one row at a time with PATCH, each sending only the changed fields, and are not part of the canvas undo history.
- **Removing a guest** runs in one transaction under the exclusive wedding lock: mark the guest deleted, rewrite every layout that seats them (found through `layout_seats`) to clear the seat, delete their `layout_seats` rows, and clear the partner link on both people. Layout versions stay as they are (change 7). Their rule and group links stay in the database, hidden, so undoing the delete in the database brings those back; their seats and partner link do not come back.
- **Partner links.** Linking or unlinking locks the up to four guests involved in id order, sets both sides, and turns the couple rule switch on for both. If someone else changed one of those links a moment earlier, the reply is 409 with a plain message.

### Migrations

The Vercel build runs `drizzle-kit migrate` only when `VERCEL_ENV` is `production`. Migrations add before they remove: a new column arrives in one release, and the old one goes in a later release, so the deployment still serving during a build keeps working.

---

## 6. Canvas editor

The timings below come from Chrome on a laptop-class machine. You check real phones by hand (change 28).

**Units and camera.** One world unit is one centimeter. 100% zoom draws 1 cm as one screen pixel, so a 60 in round table is 152 px across at 100%. Zoom runs from 10% to 800%. During a pan or zoom gesture, the editor moves an HTML wrapper around the SVG with one CSS transform per animation frame; in Chrome that took about one eighth of the time of transforming the SVG itself (1.3 ms against 10.6 ms per frame). About 150 ms after the gesture stops, the editor writes the zoom into the SVG and resets the wrapper, so the browser redraws every shape and name as vectors at full sharpness. Zooming and panning never re-render React.

**Two drawing layers.** The world SVG holds everything that scales: tables, seats, names, fixtures, walls, notes. A screen-space overlay holds what must stay the same size on screen: selection box, handles, rotate handle, the + and − seat buttons (44 px), alignment guides, the gap readout and hover cards. The overlay moves in the same frame as the camera. Table outlines and other lines that should look the same width at any zoom read a `--zoom` variable that the editor updates when the gesture stops. The grid is a CSS background on the viewport (1 ft or 0.5 m); when its lines would sit closer than 8 px on screen, only every fifth (feet) or second (meters) line shows.

**Input.** One controller handles the wheel (zoom toward the pointer, or pan for trackpad scroll, change 11), trackpad pinch (Chrome sends it as a wheel event with Ctrl; Safari on a Mac sends its own gesture events), two-finger touch pinch and pan, Space+drag, middle-button drag and right-button drag (DECISIONS 117). Clicks, Shift+click, box select, move, handles, rotate and Shift+drag resize go through one pointer handler. A press that moves more than 4 px is a drag; otherwise it is a click. On touch, holding 450 ms and then moving drags (a guest or a table); holding and letting go without moving opens the menu that right click opens on a desktop.

**Selection.** A click on a table's body or a fixture selects that item. A click on an occupied seat selects that guest, and Shift+click adds more guests, across tables if you like. On phones the menu's "Select guests" turns taps into toggles. The menu for selected guests offers Keep together, Keep apart, Add to group and Unseat. The menu for tables offers Fit seats, Lock, Duplicate and Delete.

**Keyboard.** Every shortcut is ignored while a text field has focus, and overrides the browser's own use of the key.

| Keys | Action |
|---|---|
| Delete, Backspace | Delete selection |
| Cmd/Ctrl+C, Cmd/Ctrl+V | Copy, paste |
| Cmd/Ctrl+D | Duplicate |
| Cmd/Ctrl+A | Select all |
| Cmd/Ctrl+Z; Cmd/Ctrl+Shift+Z or Ctrl+Y | Undo; redo |
| Arrow keys; Shift+arrow | Nudge one grid step; five steps. A burst of nudges is one undo step. |
| Space+drag | Pan |
| Alt (held) | No snapping to grid, guides or 15° steps |
| Shift on a handle | Keep proportions |
| Cmd/Ctrl + `=`, `-`, `0`, `1` | Zoom in, zoom out, 100%, fit to content |
| Esc | Cancel a drag, then clear the selection |

The zoom level and the zoom in, zoom out, 100% and fit buttons sit in the bottom right corner on every screen size.

**State and undo.** Each open layout gets its own Zustand stores: the document (items), which is saved and undoable; the per-device view (camera and layer switches, change 1); and the UI (selection, tool, hover, mode). Only the document reaches the server or the undo history. Undo history holds whole document snapshots, with unchanged items shared between them, capped at 200 steps. Every table and seat is a memoized component that reads only its own item, so dragging one table re-renders only that table.

**Edit and View mode.** Edit is the default on desktops; View is the default on phones (change 13). Each device remembers its last choice. View mode hides the shape panel, handles, the + and − seat buttons and the + on empty seats. A tap on a seat opens its card; a tap on a table lists its guests, read only. Search, group highlighting and pan-to-seat still work. The document store refuses every change in View mode, so keyboard shortcuts and drags do nothing either.

**Right panel.** Tabs: Properties, Guests, Groups, Problems and Notes. With nothing selected, Properties shows the Room panel and the layout's settings. When a tight table is selected, Properties says why, for example "9 seats need 16′ 6″ of edge at 22″ each; this table has 15′ 8″".

**Tables and seats.** Shape panel presets, in cm: Round 152.4 across, 8 seats; Square 121.92, 8 seats on all sides; Rectangle 243.84 by 76.2, 8 seats with no ends; Long head table 731.52 by 76.2, 12 seats on one side; Sweetheart 91.44 round, 2 seats. A pure module places seats evenly around round tables, or along the sides of square and rect tables, sharing them between sides by length. The seat circle is 45 cm across, sits 8 cm out from the edge, and is the same size everywhere: dark blue when taken, grey when empty. A 2-seat round table puts both seats side by side on the back arc, facing the room. The + button adds a seat to the side with the most spare edge; − removes an empty seat from the most crowded side, and asks first if every seat is taken. Whenever the count, size or sides change, seated guests keep their order around the table (each side of a no-ends table on its own), and − takes the empty seat out of that order, so nobody jumps across the table or changes neighbours. When a typed count or Fit seats would unseat people, the dialog names the guests in the highest seat numbers before moving them to Unassigned. Fit seats and the yellow outline use 22 in per seat on round tables and 24 in on straight edges (change 4). Tables hold at most 30 seats (round and square) or 60 (rect).

**Detail levels.** The level depends on how many screen pixels one seat circle covers, so every table switches at the same zoom. Going up: middle at 22 px, close at 36 px. Going down: middle at 30 px, far at 18 px. The gap between the up and down points stops flicker. A level change sets one attribute and puts that level's label set in a layer of its own, which fades in over 120 ms; no label set is in the page while the view zooms (DECISIONS 83).

**Name labels.** At close level each name gets a box that starts at its seat and runs outward (from the table's center on round tables, straight out from the edge on others, change 17) to halfway to the nearest other table's chairs or a wall. Within that box the label uses the full name at full size; if that does not fit, the first name and last initial, shrunk as far as 10 px on screen; if that does not fit either, the initials inside the seat circle, as at middle level. This is the spec's order. Labels turn so they never read upside down. Font sizes are worked out when the level changes or the zoom settles, never on every frame.

**Snapping and guides.** On each drag frame the editor checks the moving selection's edges and centers against nearby shapes, then against the grid. A plain scan of 640 shapes took 0.05 ms per frame, so the editor needs no spatial index. Rotation snaps to 15° steps. The gap readout measures between table edges (chairs left out, as the spec says), using the true distance between circles and rotated rectangles; it counts only tables as neighbors and shows "overlapping" when they touch.

**Seating guests.** One drag controller covers list to seat, seat to seat, seat back to the list, and the phone's tap-then-tap. A drop within a seat's circle goes to that seat, swapping if it is taken. A drop elsewhere on a table goes to its lowest-numbered free seat. A drop on a full table changes nothing and shows "Table 4 is full". While dragging, the target seat grows and gets an outline, and tables tint green (partner or group there) or red (a rule would break). Selecting a table lists every seat in order in Properties; dragging a guest onto another seat in that list moves or swaps them, the same as on the canvas, as one undo step.

**Phones.** Under 768 px wide or on a touch-only device, the canvas fills the screen. Guests and properties open in a bottom sheet with three heights: a strip with counts and search, half the screen, and nearly full. Starting a guest drag, or tapping a name, shrinks the sheet to the strip and shows "Tap a seat for Jane D. · Cancel". The shape panel opens from a button. Every tap target is at least 44 px. The page turns off browser pinch zoom, pull to refresh and the iPhone long-press callout on the canvas, so those gestures reach the editor. The typed `delete` box turns off auto-capitalize, so phones do not change it to "Delete".

**Speed target.** A Playwright test seeds 40 tables, 400 named seats and 100 shapes, scripts pan and zoom from 10% to 800%, and records frame times. It fails if more than 5% of frames take longer than 20 ms at normal speed, or longer than 33 ms with the CPU slowed 4x to stand in for a phone, or if zooming re-renders any React component.

---

## 7. Other features

**Guests page.** A table you can sort by any column, filter (group, side, RSVP, child, meal) and search (first name, last name, nickname), with every cell editable in place, an Add guest row, a Partner picker column, and a delete action whose dialog names the layouts and tables it clears. Select many rows to add them to a group at once. Paste a list of names to add guests: a comma means "Last, First"; otherwise the last word is the last name, unless a particle such as van, de, del, von or al starts it earlier ("Anna van der Berg"); honorifics are dropped. Lines holding "&" or "and" are flagged in the preview for you to split. CSV export uses the sample file's columns plus `guest_id`.

**CSV import.** A "Download sample CSV" link (on the Guests page and in the import dialog) serves a checked-in file with the spec's ten columns and about ten made-up rows covering a partner pair, `;`-split groups, accents, a child and an extra column. The tests use the same file. The browser reads the upload, handling Excel's UTF-8 and older encodings and semicolon files, then shows the column matching step with the first ten rows. Partner names are matched against rows in the file first, then live guests, by first and last name ignoring case and accents; a name that matches no one, or more than one person, or a person who names someone else, goes to an "Unmatched partners" list with a guest picker on each row. Likely duplicates (same name, or close spellings) are flagged. The server builds the re-import summary (new, changed with their fields, missing from the file, needs review), including the layouts and tables a removal touches, then applies everything in one transaction. Parsing, column guessing, name matching, duplicate detection, partner matching, name splitting and the re-import diff are pure modules with unit tests.

**Seated and unassigned.** The editor's side list shows Unassigned and Seated (with table names), counts at the top such as "142 guests · 118 seated · 24 unassigned · 6 declined", where the first three count guests who said yes or have not answered. A search box filters as you type on first name, last name and nickname. Filters for group, side and RSVP sit under the search; on phones they open from the sheet's half height. Guests who answered no are hidden from Unassigned until you tick "Show declined". Clicking a seated name zooms to at least close level, centers the seat and pulses it for two seconds, in both modes.

**Rules.** A pure function takes the layout, guests and rules and returns problems per table, per seat and overall. It indexes seats once; a benchmark test with 400 guests, 40 tables and 200 rules fails above 8 ms, half the spec's 16 ms. Together rules with some guests unseated show grey as unfinished. In ceremony layouts a row is the unit and only guests seated by name count (change 18). The Rules page flags clashes (change 16) and lets you add a whole group's members at once. The module arrives in milestone 5, since the red tint while dragging needs it; its pages and badges come in milestone 6.

**Groups and closeness.** The Groups page adds, renames, recolors and deletes groups and adds members from the guest table or from selected seats. In the editor you pick one to three groups to show: their seated members get a ring in the group color and everyone else fades. Each group's closeness line follows the spec's formula with change 19; with no seated members it shows only "0 of 12 seated" and sorts last. Tooltips explain each number in plain words. In ceremony layouts, rows stand in for tables.

**Room panel.** Total seats against guests who said yes or have not answered. "Most common size" is the most frequent seat count among tables that are not one-sided (ties go to the larger). Tables needed is the shortfall of seats divided by that size, rounded up. Dance floor area per guest uses the same guest count. Ceremony layouts show total chairs against two counts, guests who said yes and guests who said yes or have not answered, and show reserved chairs next to them.

**Wedding settings.** A dialog from the wedding header sets name, date, unit (feet or meters) and the minimum gap between tables. The mouse wheel setting (change 11) sits in the editor's settings menu.

**Venue templates.** The Venues tab lists templates with rename in place, Duplicate, and Delete with the typed `delete` dialog. Delete is blocked while live layouts in live weddings use the template, and the dialog lists them. A layout whose template was deleted (for example after restoring its wedding in the database) opens with a notice and no venue layer, and you can pick another template in its settings. The template editor reuses the canvas with a tool for every fixed item type: wall (click to place points, double-click to finish), room (drag a rectangle, or click points), door and window (drop onto a wall, where they snap), column, stairs, built-in bar, patio edge, zone (named area) and label. Selecting a wall segment or room side shows a length field that takes any unit format and moves the segment's far end along its line. When a template save puts a wall through a table, the template editor lists every layout and table affected, and each layout flags that table when it opens.

**Floor plan import.** In the browser, pdf.js opens a PDF and decides whether it holds vector drawing or a scanned picture. It renders the chosen page to a PNG at 2,576 px on the long edge, which the model reads without shrinking, using the page's own rotation and crop. For vector PDFs it also reads the stroked lines in that same pixel space, keeps the thick long ones as wall candidates, merges and snaps them, caps them at about 1,500, and reads dimension text with its position. The browser uploads the PNG; the import route reads it by id, sends it and (for vector PDFs) the numbered lines to the model with a JSON schema, and checks the reply with Zod. A reply cut off at the length limit, or a refusal, shows a clear message and a Retry button. Walls in a vector PDF come from the PDF's own lines (change 21).

**Scale.** For a vector PDF, the app measures each dimension line in the PDF's own geometry. For any plan, it works out a scale from every dimension label found and shows how far they disagree. Before Accept, it shows one labelled wall measured at the chosen scale and asks you to confirm. If the labels disagree by more than 2%, or none were found, it asks you to click two points and type the real distance. Your room sizes (item D) are a further check for the Toronto Beach Club.

**Draft and Accept.** The draft draws over the faded original; every shape stays editable, and items the model marked unsure are highlighted. Nothing changes in the template until Accept. Rerun starts again from the same image. "Undo import" restores the revision from before the import, at any later time. The original image stays on a hidden reference layer you can turn on.

**Ceremony.** The ceremony shape panel holds the seating block tool, a single chair row, the ceremony fixtures (ceremony structure with an editable label, officiant spot, aisle runner, musicians, sound desk, welcome sign, entrance) and plain shapes; it has no tables. The seating block tool asks for rows, chairs per row, aisle width and side labels, with defaults of 20 in per chair, 36 in from one row to the next, a 6 ft aisle, and "Noa's side" and "Aiden's side". It places one chair row per side per row, numbered from the front. After that each row is its own item: "Select block" picks all rows of a block to move or change together, "Add row behind" adds a row 36 in back with the next number, and changing a row's chair count uses the same unseat dialog as tables. Rows can be reserved with a label such as "Family, row 1" or seated by name.

**Annotations.** Sticky note, text, arrow, line, box and circle in six colors, on the notes layer, with a button to show or hide all notes and one to lock them. Each note records its author from the Noa / Aiden switch. An arrow attached to a table or fixture at either end recomputes that end when the item moves. The Notes tab lists every note; clicking one pans to it; marking it done greys it out.

**Exports.** The floor plan export dialog offers PDF or SVG, detail level (full names, initials, or table names only), include notes (on by default), and Letter or Tabloid paper in landscape. The print renderer draws only the chosen level, with plain SVG attributes and no CSS classes or variables, since the PDF library ignores page CSS. Names use the same label fitting as the screen at the paper's scale, at 6 pt or larger; the dialog suggests Tabloid or initials when Letter would push names smaller, and Tabloid is the default for full names. Static Noto Sans Regular and Bold files are embedded so accents print. The table list (PDF and CSV) gives each table with its guests and meal counts and leaves out guest notes. The escort card list (PDF and CSV) sorts seated guests by last name with their table number. The ceremony list (PDF) gives reserved rows and named seats. CSV files start with a byte order mark so Excel reads accents, and cells that start with `=`, `+`, `-` or `@` get a leading apostrophe, so Excel shows them as text and never runs them as formulas.

**Backup and restore.** Backup downloads one JSON file with the wedding's guests, groups, rules, layouts and the templates they use, images included. Restore creates a new wedding. It builds one map from old ids to new ones and rewrites every guest id inside seats, partner links, group members and rule guests through it, then writes each canvas through `writeCanvas()`. Templates follow change 5. Vercel refuses request bodies over 4.5 MB, so the browser sends the restore in steps: the wedding's rows, then each layout, then each template, then each image as raw bytes. Share links are left out.

**Share view.** The share page shows the layout in View mode with search (when names are on), nothing else. The server builds its data from the link's settings (change 24). The page fetches again when it regains focus and every 60 seconds, and when the link has been turned off or its password changed, it clears the plan and shows the password page.

**Seed.** `npm run seed` makes a demo wedding from a fixed random seed, so every run gives the same data: about 120 made-up guests, 8 groups, 20 couples and 5 rules. Its reception layout has about 14 tables of mixed presets, including a head table and a sweetheart table, with about 100 guests seated, one broken apart rule, one split couple, one tight table, and a few notes including an attached arrow. Its ceremony layout has a seating block, one reserved row and a few named seats. The seed also makes the empty Toronto Beach Club template. `npm run seed:perf` makes the 40 table layout for the speed test. Neither holds real data or the password.

---

## 8. Folder layout

```
seat-plan/
  PLAN.md  DECISIONS.md  README.md  env.example  .gitignore  .nvmrc
  docs/SPEC.md                    # the brief, password removed
  package.json  next.config.ts  tsconfig.json  eslint.config.mjs  postcss.config.mjs
  drizzle.config.ts  vitest.config.ts  playwright.config.ts  vercel.json
  .github/workflows/ci.yml
  drizzle/                        # generated SQL migrations and snapshots
  public/fonts/                   # Noto Sans Regular and Bold
  public/samples/guests-sample.csv
  scripts/
    seed.ts  seed-perf.ts  reset-test-db.ts
    check-secrets.ts              # SITE_PASSWORD in .next/static or git history
  e2e/
    ACCEPTANCE.md                 # the table in section 9, kept up to date
    fixtures/                     # floor plan PNG, vector PDFs (one rotated), recorded AI replies
    stand-in-anthropic.ts         # local server that returns recorded replies
    *.spec.ts
  src/
    proxy.ts
    app/
      layout.tsx  globals.css  robots.ts
      login/
      (app)/page.tsx                                       # home
      (app)/w/[weddingId]/(tabs)/layouts|guests|groups|rules|venues|links/page.tsx
      (app)/w/[weddingId]/layouts/[layoutId]/page.tsx      # editor
      (app)/venues/[templateId]/page.tsx                   # template editor
      share/[token]/page.tsx  share/[token]/login/route.ts  share/[token]/data/route.ts
      api/...                                              # route handlers from section 5
    domain/                       # plain TypeScript, no React; each file has a .test.ts
      units.ts  geometry.ts  seats.ts  detail-level.ts  labels.ts  camera.ts  snapping.ts
      spacing.ts  rules.ts  closeness.ts  room-stats.ts  ceremony.ts  walls.ts  arrows.ts
      canvas-schema.ts  history.ts  thumbnail.ts  ids.ts
      names.ts                    # fold, compare, split pasted names
      csv/  decode.ts  parse.ts  columns.ts  partner-match.ts  import-diff.ts  export.ts
      floorplan/  pdf-vectors.ts  cleanup.ts  scale.ts  draft-schema.ts  to-fixed-items.ts
      print/  plan-svg.ts  table-list.ts  escort.ts  ceremony-list.ts
      backup/  schema.ts  remap.ts
    server/                       # each file imports 'server-only'
      db/  schema.ts  client.ts
      auth/  password.ts  cookies.ts  throttle.ts  require.ts
      canvas-write.ts             # writeCanvas(): every canvas write goes through here
      repo/  weddings.ts  layouts.ts  guests.ts  groups.ts  rules.ts  venues.ts  share-links.ts
      ai/  floorplan-import.ts
      backup.ts
    client/
      sync/  outbox.ts  autosave.ts  row-save.ts  tab-lock.ts  ConflictDialog.tsx
      editor/  Editor.tsx  Viewport.tsx  WorldSvg.tsx  Overlay.tsx
               items/  panels/  input/  stores/  tools/  icons/
      template-editor/  guests/  groups/  rules/  layouts/  share/  export/
      ui/  BottomSheet.tsx  Dialog.tsx  TypedDeleteDialog.tsx  InlineName.tsx  ...
```

---

## 9. Tests, with every acceptance check mapped

- **Vitest, pure modules.** Every file in `src/domain/` has tests: seat placement, Fit seats and seat moves on resize, neighbors per side rule, detail level switching, label fitting (no two label boxes overlap in the seeded layout, on screen or in print), camera math, snapping, gap distances, rules (with the 8 ms benchmark), closeness, CSV decode, column guessing, partner matching, name folding and duplicates, re-import diff, the pdf.js reader against generated vector PDFs (one with a rotated page), AI draft schema and conversion, scale from labels, unit formatting, backup id remapping, print SVG (no class or style attributes; each seated name appears once).
- **Vitest, server.** Repository functions and route handlers run against a real local Postgres test database: version conflicts, saved-twice protection, one seat per guest, guest removal across layouts racing a save, partner links pointing both ways, share link sign-out, a share cookie used as a site cookie (401), the login counter under parallel guesses, and a check that `layout_seats` matches every stored canvas.
- **Playwright.** Two projects for every flow: `desktop` at 1440 x 900 and `phone` at 390 x 844 with touch. They run against a production build and a fresh, seeded test database. Touch drags and long presses go through Chrome's own touch events, as they would in Chrome on a phone. A third `perf` project runs the speed test. The AI import tests point the SDK at a small local stand-in server (the SDK honors `ANTHROPIC_BASE_URL`) that returns recorded replies, so they need no key.
- **Signed-out access.** One test visits every page and API route without the cookie and expects a redirect or 401, with no guest name anywhere in the reply. Another signs in, records every response the app loads, and checks none contains the password.
- **Secret check.** `scripts/check-secrets.ts` reads `SITE_PASSWORD` from the environment and fails if it appears in `.next/static` or anywhere in `git log -p --all`. Tests sign in with a password made fresh for each run, so the real one never appears in a test.
- **CI.** GitHub Actions with a Postgres service: typecheck, lint, Vitest, build, bundle secret check, Playwright. If you add the real password as a GitHub secret named `SITE_PASSWORD_REAL`, CI also runs the history check.

| # | Acceptance check (spec section 13) | Tests | Who |
|---|---|---|---|
| 1 | Password page in a private window; wrong password errors; right one opens and survives a browser restart | `e2e/auth.spec.ts`; cookie attributes and 30 day expiry | Tests, and you for a real browser restart |
| 2 | No page or route returns data without the cookie; password not in bundle or git history | `e2e/signed-out.spec.ts`; route auth unit tests; `check-secrets` | Tests |
| 3 | Noa adds a table on a laptop; Aiden reloads on a phone and sees it | `e2e/two-devices.spec.ts` (desktop and phone contexts) | Tests, and you on real devices |
| 4 | Phone opens in View, drag pans without moving anything, Edit allows changes; laptop opens in Edit | `e2e/modes.spec.ts` | Tests |
| 5 | Search a name, click it, canvas pans to the seat, on phone and laptop | `e2e/search.spec.ts` | Tests |
| 6 | Dragging a name onto a table seats them (dark blue); unseating turns the circle grey | `e2e/seating.spec.ts` | Tests |
| 7 | + on an 8-seat round gives 9 evenly spaced circles | `seats.test.ts`; `e2e/seat-count.spec.ts` | Tests |
| 8 | Zooming a 10-seat table 800% to 10% shows names, initials, then circles, no flicker | `detail-level.test.ts`; `e2e/detail-levels.spec.ts` (small zoom wiggles at each switch point change the level at most once) | Tests |
| 9 | Shapes and text stay sharp at 800% | `e2e/sharpness.spec.ts`: after the zoom settles, the world layer holds no raster images and a screenshot of a name matches a direct SVG render | Tests, and you on an iPhone |
| 10 | Rect stretched to 24 ft plus Fit seats gives 12 on one side; round shrunk to 36 in with 2 seats is a sweetheart table | `seats.test.ts`; `e2e/resize.spec.ts` (both readings in Q3) | Tests |
| 11 | Shift+drag resizes a round table about its center; Shift+click still changes the selection | `e2e/resize.spec.ts`; pointer handler tests | Tests |
| 12 | 12 seats spaced evenly; dropping to 8 with 10 seated asks before unseating 2 | `seats.test.ts`; `e2e/seat-count.spec.ts` | Tests |
| 13 | Importing the sample CSV twice creates no duplicates; second import reports 0 new | `import-diff.test.ts`; `e2e/csv-import.spec.ts` | Tests |
| 14 | Partners at different tables show a problem on both tables | `rules.test.ts`; `e2e/rules.spec.ts` | Tests |
| 15 | Apart rule at one table shows a problem; moving one guest clears it | `rules.test.ts`; `e2e/rules.spec.ts` | Tests |
| 16 | No table over 10 seats; a group of 12 over two tables scores 100% tight | `closeness.test.ts`; `e2e/groups.spec.ts` | Tests |
| 17 | Delete disabled until `delete` is typed; other layouts unchanged after a layout delete | `e2e/delete.spec.ts`; server test | Tests |
| 18 | Two tabs on one layout: the second save warns | `e2e/conflict.spec.ts` (both tabs edit before either saves); server test for 409 | Tests |
| 19 | Closing the tab right after an edit and reopening shows the edit | `e2e/close-tab.spec.ts` (saves blocked, page closed within 200 ms, reopened) | Tests |
| 20 | The exported floor plan PDF prints with readable names at full-name detail | `e2e/export.spec.ts`: reads the PDF's text and font sizes, every name present once at 6 pt or larger | Tests, and you print one page |
| 21 | A share link asks its own password, opens only that layout in View, and turning it off signs the viewer out | `e2e/share.spec.ts` (an open viewer sees the password page within 60 seconds of the link going off) | Tests |
| 22 | An uploaded floor plan image returns an editable vector draft over the faded original; nothing changes until Accept | `e2e/venue-import.spec.ts` with the stand-in server | Tests |
| 23 | A vector PDF imports its walls from the PDF's own lines | `pdf-vectors.test.ts`; `e2e/venue-import.spec.ts` | Tests |
| 24 | Tapping + on an empty seat on a phone lists unassigned guests; picking one seats them | `e2e/seat-plus.spec.ts` (phone) | Tests |
| 25 | Pasting 10 names adds 10 guests after a preview | `names.test.ts`; `e2e/paste-names.spec.ts` | Tests |
| 26 | Dragging a table within 5 ft of another shows the gap and a warning, and the move still happens | `spacing.test.ts`; `e2e/space-check.spec.ts` | Tests |
| 27 | 40 tables and 400 seats pan and zoom smoothly on a laptop and a phone | `e2e/perf.spec.ts` | Tests, and you on your phones |

---

## 10. Milestones and how each one ships

Same order as the spec. Each milestone goes on its own branch. At the end I run every test, commit with a plain message saying what changed and why, run the secret check on git history, merge into `main` and push, which deploys to your live site (change 29). Then I tell you what to try on a laptop and on a phone, and start the next milestone. Each milestone also grows the seed with what it adds.

1. **Setup.** Scaffold, `docs/SPEC.md`, password gate, login slow-down and logout, the `/share/` path left open for its own check, `robots.ts`, full database schema and first migration, empty home screen, seed skeleton, CI, secret check, `e2e/ACCEPTANCE.md`, `env.example`, README with deploy notes. Done when your Vercel URL shows the password page and the right password opens an empty home.
2. **Weddings and layouts.** Home cards; wedding tabs; wedding settings dialog; create, open, rename in place, duplicate and delete (typed `delete`, with the delete summary) for weddings and layouts; the Noa / Aiden switch; `writeCanvas()`, the save engine with drafts, tab locks, saved-twice protection, retries and the conflict dialog; the shared data rules (one seat per guest, guest removal across layouts); thumbnails. The editor shows a bare canvas with an "add round table" button, enough to prove saving end to end.
3. **Canvas.** Camera, grid, zoom controls, shape panel with presets and fixtures (each with a vector icon), selection, move, nudge, resize by handles and Shift+drag, rotate, guides, align and distribute, copy, paste, duplicate, delete, undo and redo, lock, table numbers, seat circles with + and −, Fit seats and the yellow outline, keyboard shortcuts, Edit and View modes, right panel, gap readout, mouse wheel setting, phone layout and gestures, speed test.
4. **Guests.** Guests page (sort, filter, search, edit in place, add, delete with summary, partner picker, bulk group add), basic group create and rename (the import creates groups), sample CSV download, CSV import with column matching, partner matching, duplicates and the re-import summary, paste names, CSV export, the seated and unassigned lists with counts, search and filters.
5. **Seating.** Drag guests to seats on desktop and touch, drop rules, tap-then-tap, + on empty seats, swap, unseat, seat selection and its menu, the table's seat list with drag to reorder, the unseat dialog, detail levels and name labels, hover and tap cards, search and pan to seat, Room panel, the rules module for the drag tint.
6. **Rules and groups.** Rules page (add whole groups, couple rules and their switches, clash flags), Keep together and Keep apart from the canvas menu, badges, top bar count and Problems tab with pan to problem, Groups page, group highlighting, closeness scores with tooltips.
7. **Venues.** Template list with rename, duplicate and typed delete; template editor with every fixed item tool and the length field; image and PDF import with the stand-in tests; scale step; draft, Accept, rerun and undo import; wall crossing flags; the deleted-template notice; blank canvas tools; the Toronto Beach Club template, from your files.
8. **Ceremony layouts.** Ceremony shape panel, seating block tool, single rows, Select block and Add row behind, ceremony fixtures, reserved rows, named chairs, chair counts.
9. **Annotations.** Note tools, notes layer controls, attached arrows, Notes tab.
10. **Exports, backup and share links.** Floor plan PDF and SVG with the dialog's options, table list, escort card and ceremony exports, backup and stepwise restore, share links (create, change password, turn off, names and notes options), the Links tab, and the share view.

---

## 11. Deploy steps for you

Once the repo exists and holds milestone 1:

1. In Vercel, choose Add New, then Project, and import the GitHub repo. Keep the defaults; the repo's `vercel.json` sets the build command. This first deployment fails, because there is no database or password yet. That is expected; step 4 redeploys it.
2. In the project, open Storage, then the Marketplace, then Neon. Create a new database in **AWS us-east-1**, where Vercel runs the app by default, and connect it to **Production only** (change 29).
3. In Settings, then Environment Variables, add these for Production:
   - `SITE_PASSWORD`: the site password (see the advice under section 2).
   - `AUTH_SECRET`: a random string of at least 32 characters. In a terminal: `openssl rand -base64 32`.
   - `ANTHROPIC_API_KEY`: needed from milestone 7.
4. Redeploy. The build checks these settings and names any that are missing, runs the database migrations, builds the app and runs the secret check on the build output.
5. Open the URL in a private window. You should see the password page.

To run it on a laptop of your own: copy `env.example` to `.env.local`, fill in the same values plus a local `DATABASE_URL`, then run `npm install`, `npm run db:migrate`, `npm run seed` and `npm run dev`.
