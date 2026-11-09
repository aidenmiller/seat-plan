# Decisions

Where the spec says nothing, I pick the simpler option and log it here. Changes to what the spec says are in `PLAN.md` section 2, where approving the plan approves them. Newest at the bottom.

| # | Area | Decision | Reason |
|---|------|----------|--------|
| 1 | Units | One world unit is one centimeter. 100% zoom draws 1 cm as one screen pixel. | Matches the spec's storage unit. A 30 m room is 3,000 px wide at 100%, so "fit to content" lands near 40%. |
| 2 | Units | Feet show as feet and inches to the nearest inch (`5′ 6″`), meters to two decimals, areas as whole square feet or m² to one decimal. | Easy to read; the spec gives no rounding. |
| 3 | Geometry | `x` and `y` on every item mean its center. Rotation is in degrees, clockwise, about the center. | Rotation and resizing about the center need no extra math. |
| 4 | Seats | Seat circles are 45 cm across and sit 8 cm out from the table edge. | Close to a real chair; the spec needs one size everywhere. |
| 5 | Seats | One-sided tables put their seats along the back edge (local top), facing the room. Rotate the table to aim it. | The spec says "facing the room" with no room direction to read. |
| 6 | Seats | A 2-seat round table places both seats side by side on the back arc. | The spec's sweetheart preset is a 36 in round with 2 seats side by side. |
| 7 | Seats | The rect preset (8 ft by 30 in, 8 seats) seats the two long sides only: 4 on each. The square preset seats all four sides, 2 per side. | Gives the spec's seat counts at 24 in per seat. |
| 8 | Seats | On tables seated on all sides, seats are shared between sides by length, the largest remainder going first. | Spaces seats as evenly as the shape allows. |
| 9 | Seats | + adds a seat to the side with the most spare edge; − takes an empty seat from the most crowded side. When the count, size or sides change, each seated guest moves to the nearest new seat. | Nobody jumps across the table when the seats re-space. |
| 10 | Seats | When a count change would unseat people, the guests in the highest seat numbers go, and the dialog names them first. | Predictable, and you see who moves. |
| 11 | Tables | Minimum size 24 in (60.96 cm) on every side. Round tables keep width equal to height through every resize. Seat limits: 30 on round and square tables, 60 on rectangles. | Spec, plus a cap so the + button cannot add more seats than any table could hold. |
| 12 | Rules | Seated guests are checked whatever their RSVP; a seated guest who answered no also gets a warning. Unseated guests never break a rule. | One plain rule, and the warning catches the real mistake. |
| 13 | Rules | A rule applies to a layout when its `appliesTo` is `both` or matches the layout's kind. Couple rules apply to both kinds. | Spec field, made explicit; couple rules have no row to set it on. |
| 14 | Problems | A wall through a table counts as a problem. Tight tables, narrow gaps and seated guests who answered no are warnings. Only tables count as neighbors for the gap check; touching tables show "overlapping". | PLAN change 16. |
| 15 | Walls | Wall crossings are worked out when a layout opens and after each move, from the template's walls and the layout's tables. Nothing is stored. | Templates can change at any time, and a stored flag would soon be wrong. |
| 16 | Editor | Zoom, pan and the layer switches are kept per device. Selection, tool and hover are never kept. | PLAN change 1. |
| 17 | Editor | Undo covers canvas edits only, seating included. Guest, group and rule edits save at once, one row at a time, outside the undo history. | They are stored outside the layout. |
| 18 | Editor | Loading the other person's version clears this tab's undo history. | Undo would otherwise put back a snapshot that wipes their work. |
| 19 | Mode | Edit or View is remembered per device. The first visit picks View on phones and touch-only devices or under 768 px wide, else Edit. | Spec, plus PLAN change 13. |
| 20 | Author | The Noa / Aiden switch is remembered per device. The first visit asks. | No accounts in v1. |
| 21 | Guests | Seat labels use first name and last name. Nicknames show in search and the hover card. | Default for open question Q2. |
| 22 | Guests | The side list's counts ("142 guests · 118 seated · 24 unassigned") count guests who said yes or have not answered; declined guests show as a separate number. | A declined guest needs no seat. |
| 23 | Search | Clicking a seated name zooms to at least close level before the seat pulses. | You can then read the names around them. |
| 24 | Import | Unknown CSV columns go into notes as `column: value` lines, once. | The spec says "into notes"; this keeps the column name. |
| 25 | Paste | A comma means "Last, First". Otherwise the last word is the last name, unless a particle (van, von, de, del, da, di, du, la, le, al, bin, ben) starts it earlier. Honorifics are dropped. Lines holding "&" or "and" are flagged in the preview for you to split. | Covers the usual cases; you fix the rest in the preview. |
| 26 | Share | A share link always shows the layout as last saved. | The spec's "latest version". |
| 27 | Share | Each share link has a label (Caterer, DJ) for the Links list. | Hard to tell links apart otherwise. |
| 28 | Templates | Template saves raise a version and use the same conflict check and saved-twice protection as layouts. | The template editor saves the same way as the layout editor. |
| 29 | Templates | A layout whose template was deleted opens with a notice and no venue layer; its settings let you pick another template. | Restoring a wedding in the database can bring back such a layout. |
| 30 | Delete | Deleting a layout leaves its share links in the database, but they stop working. | Undoing the layout delete in the database brings the links back. |
| 31 | Delete | Weddings, layouts, templates and guests are marked deleted and kept. Groups and rules are deleted outright. | The spec asks for the first three to be kept. Guests carry group and rule links worth getting back; their seats and partner link are cleared on removal (PLAN change 7). |
| 32 | Delete | Deleting a wedding marks only the wedding row. | Every query skips rows whose wedding is deleted, so clearing that one field brings everything back. |
| 33 | API | API routes reply 401 without a valid cookie; pages go to `/login`. | A redirect means nothing to `fetch`. |
| 34 | Ceremony | After the seating block tool places rows, each row is its own item. "Select block" picks them all; "Add row behind" adds one. | Rows stay simple items, and the spec wants each row editable on its own. |
| 35 | Grid | When grid lines would sit closer than 8 px on screen, only every fifth (feet) or every second (meters) line shows. | Dense lines turn the canvas grey and hide the plan. |
| 36 | Runtime | Node 22 (`engines: 22.x`, so Vercel never moves to a newer major on its own). npm as the package manager. | Matches this sandbox and pdf.js's minimum. pnpm blocks install scripts by default, which can break packages that build native code on Vercel. |
| 37 | Branches | Each milestone is built on its own branch and merged into `main` when its tests pass. | Vercel deploys `main` to the live site (PLAN change 29). |
| 38 | Next.js | Cache Components and partial prefetching stay off. | Every page sits behind the password and reads fresh data, so there is nothing to cache, and leaving them off keeps the usual dynamic rendering. |
| 39 | Tests | `@playwright/test` is pinned to 1.63.0, the version whose Chromium is installed in this sandbox. | A newer version would look for a browser that is not there. CI installs the matching browser itself. |
| 40 | Templates | The empty Toronto Beach Club template comes from a database migration. | Production gets it on the first deploy, and every wedding sees it. |
| 41 | Auth | Cookie names are `sp_site` and `sp_share_<linkId>`. The logout route needs the site cookie, like every other route. | Otherwise another site could sign you out with a hidden form. A signed-out tab still lands on the login page. |
| 42 | Files | The env template is `env.example`, without the leading dot. | This environment's security rules block any file named `.env*`, even one with blank values. |
| 43 | Auth | The proxy sends signed-out visitors to `/login` and adds `?next=` for any page other than home. | Returns them to the page they asked for. |
| 44 | Crawlers | `robots.txt` lets crawlers in; every response carries `X-Robots-Tag: noindex, nofollow`. | A crawler kept out by `robots.txt` never sees the noindex header and can still list the bare URL. |
| 45 | Auth | A production build fails, naming the setting, when `SITE_PASSWORD`, `AUTH_SECRET` (32+ characters) or `DATABASE_URL` is missing. | Otherwise the site deploys and then fails at sign-in with no clue why. |
| 46 | Auth | When a login block starts or ends, its count starts again from zero. | Without this, attempts during a block kept renewing it for up to an hour, longer than the 15 minutes promised. |
| 47 | Editor | The editor's document store is a small store read with React's `useSyncExternalStore`; Zustand is not installed (PLAN section 3 named it). | The store needs only get, set and subscribe, and one less dependency. Undo uses `src/domain/history.ts` either way. |
| 48 | Author | The "Who is using this device?" prompt sits in a corner and does not block the page. Editing, Duplicate and New layout wait until someone picks, with a short note saying why. | Reading needs no author; every save records one. |
| 49 | Saving | Renaming a layout or changing its template leaves its version and "last edited" time alone. "Last edited" follows canvas saves. | A rename is not an edit to the plan, and must not cause a save conflict. |
| 50 | Saving | Leaving the editor inside the app sends waiting edits first, waiting up to 3 seconds. | The layouts list then shows the latest thumbnail and time. |
| 51 | Saving | The server keeps the ids of the 20 most recent saves of each layout. A retried save that landed earlier gets "already saved" with that save's version, and a reopened tab uses the list to tell that its last save landed. | One remembered id was not enough: once anyone saved after it, a landed save looked lost and showed a false conflict, which iPhones hit when a tab is closed from the switcher. |
| 52 | Text | Free text in layouts and names has NUL characters removed and broken emoji halves repaired before saving. | Postgres refuses both, and the save would fail and retry forever. |
| 53 | API | Ids that are not uuids get 404. Lists reply with plain arrays. Creates reply 201 with the full object. | Plain, predictable replies. |
| 54 | Seed | `npm run seed` runs tsx with the `react-server` condition, so it writes layouts through the app's own `writeCanvas()`. | Every canvas write goes through one function (PLAN section 5). |
| 55 | Recovery | After a 410 (layout deleted elsewhere) or 422, the editor offers "Save as a copy" (a new layout in the same wedding) before "Download a copy". | Unsaved work stays in the app. |
