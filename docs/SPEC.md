# Wedding Seating Planner: Claude Code Prompt

Nov 8, 2026 · @Aiden

## 1. What you are building

Build a web app that Noa and Aiden will use to plan the guest list and seating for their wedding. The heart of the app is an overhead floor plan of the venue. They place tables and fixed features on it (food, bar, DJ, dance floor), drag guests onto tables, and see each table with its guests' names around it. The editor should feel like Lucidchart: a large canvas they can pan and zoom, a panel of shapes to drag in, and handles to move, resize and rotate things.

The app has two levels. A wedding holds the guest list, named guest groups and seating rules. Each wedding holds any number of layouts. A layout is one version of a floor plan with its own tables and seat assignments, so they can try a few seating ideas side by side. A layout is either a reception layout or a ceremony layout.

Both of them will use the app from their own laptops and phones. Store all data in a server database so each person sees the same weddings and layouts on any device, and they lose nothing when they close the tab.

Leave these out of v1: user accounts beyond the shared password, RSVP collection, live editing with two cursors, and an automatic seating solver. Shape the data so we can add a solver later.

## 2. Stack, hosting and the password gate

- Next.js (App Router) with TypeScript in strict mode, deployed on Vercel.
- Postgres from the Vercel Marketplace (Neon), with Drizzle ORM and migrations checked into the repo. Check the current Vercel docs for how to add it, since Vercel has changed its storage options more than once.
- Draw the canvas as SVG inside React. Every shape, label and icon must be vector so it stays sharp at any zoom. Write pan and zoom yourself or use a small library such as d3-zoom. Do not use a whiteboard SDK that needs a paid license or adds a watermark, such as tldraw.
- Zustand for editor state, with undo and redo history.
- Tailwind CSS for styling.
- Vitest for logic (rule checks, closeness scores, CSV parsing, seat placement, detail level choice) and Playwright for the main end-to-end flows.

### Password gate

The site has one shared password. Anyone who opens the public link lands on a password page. The right password lets them into the whole site. A wrong one shows an error and lets them try again.

- Keep the password in an env var named `SITE_PASSWORD`. Its value is kept out of this repo; the owners hold it. Put it in `.env.local` (git-ignored) and in the Vercel project's environment variables. Never write it into source code, tests, seed data or anything sent to the browser.
- Check the password on the server in an API route, comparing in constant time. Add a short delay after each wrong guess.
- On success, set an HttpOnly, Secure, SameSite=Lax cookie holding a token signed with a second env var, `AUTH_SECRET`. The cookie lasts 30 days.
- Use the Next.js request interceptor (`middleware.ts`, renamed `proxy.ts` in newer versions; use whichever the installed version expects) to send any request without a valid cookie to `/login`. This covers every page and every API route except the login page and the login route.
- Add a log out button.
- Send `noindex` headers so search engines skip the site.
- Build the gate in the app itself so it works on any Vercel plan.

### View-only link for the venue

- A Share button makes a view-only link for the venue coordinator, caterer or DJ. It opens the latest version of one layout in View mode and shows nothing else: no other layouts, guest notes or rules.
- Each link has its own password, separate from the site password, so we can hand it out without giving anyone the whole app. We set it when we make the link and can change it later. Store only a hash of it (argon2 or bcrypt), never the plain text.
- Opening the link shows a password page. The right password sets a cookie that opens that one link for 30 days. Use the same constant-time check and slow-down after wrong guesses as the site password.
- Each link also carries a long random token in its URL. The site password check lets `/share/<token>` through to this second check. The site password opens every share link too.
- A Links list shows every live link and when it was last opened. We can change a link's password or turn the link off, and either one signs out anyone using it.
- Each link can show full names or table names only.

## 3. Data model

Guests, groups and rules belong to the wedding and are shared by all its layouts. Seat assignments belong to each layout. Store every position and size in centimeters and show them in the wedding's chosen unit (feet by default, meters as an option). Treat the sketch below as a starting point and adjust it in your plan.

```
Wedding
  id, name, date?, unit ("ft" | "m"), createdAt, updatedAt, deletedAt?

Guest (belongs to Wedding)
  id, weddingId, firstName, lastName, nickname?,
  partnerId?        // links two guests as a couple
  household?        // free text, for families
  side ("Noa" | "Aiden" | "Both"), rsvp ("yes" | "no" | "pending"),
  meal?, isChild, notes?

Group (belongs to Wedding)
  id, weddingId, name ("Aiden HS Friends"), color
GroupMember
  groupId, guestId  // a guest can be in many groups

Rule (belongs to Wedding)
  id, weddingId, kind ("together" | "apart"), guestIds (2 or more),
  nextToEachOther (together only), appliesTo ("reception" | "ceremony" | "both"),
  enabled, note?
  // each couple (partnerId) gets an implied together + nextToEachOther rule
  // that shows in the rules list and can be switched off

VenueTemplate
  id, name, fixedItems (walls, rooms, doors, windows, columns, built-in bars, zones),
  referenceImage? { url, scale, offset, opacity }
  importedBy ("hand" | "pdf vectors" | "ai")

ShareLink (belongs to Layout)
  id, layoutId, token, passwordHash, showNames, lastOpenedAt?,
  createdAt, revokedAt?

Layout (belongs to Wedding)
  id, weddingId, name, kind ("reception" | "ceremony"),
  venueTemplateId?  // null means blank canvas
  version           // goes up on every save, used to catch conflicts
  editedBy ("Noa" | "Aiden"), updatedAt, deletedAt?
  canvas (jsonb, below)

canvas
  items: [
    Table    { id, shape ("round" | "square" | "rect"), x, y, width, height, rotation,
               name, seatCount, seatSides, seats: [{ index, guestId? }], locked }
    Fixture  { id, type ("food" | "bar" | "dj" | "danceFloor" | "stage" | "cake" | "gifts" |
               "photoBooth" | "ceremonyStructure" | "custom"), x, y, width, height,
               rotation, label, locked }
    ChairRow { id, x, y, rotation, chairCount, spacing, rowLabel, blockLabel?,
               reservedFor?, seats: [{ index, guestId? }] }
    Shape    { id, type ("rect" | "ellipse" | "line" | "text"), geometry, style }
    Note     { id, type ("sticky" | "text" | "arrow" | "line" | "box" | "circle"),
               geometry, text?, color, author?, attachedTo?, done }
  ]
  layers: { venue, furniture, notes } each with visible and locked
  view:   last zoom and pan, so the layout reopens where it was left
```

A guest may hold at most one seat per layout. Check this on the server when saving. When a guest is removed from the wedding, clear their seats in every layout in the same transaction.

## 4. The canvas editor

The screen has three parts, as in Lucidchart: a shape panel on the left, the canvas in the middle, and a right panel with tabs for the selection's properties, guests, groups and problems.

### Edit mode and View mode

- A switch in the top bar flips between Edit and View. Edit is the default on desktops. View is the default on phones and screens under 768 px wide. Anyone can switch at any time, and each device remembers its last choice.
- View mode is for looking around. Pan, zoom, search, tap a table or seat to see who sits there, and highlight groups. Nothing on the canvas can move or change, so a stray touch can't break the plan. Hide the shape panel, handles and + and − buttons.
- Edit mode allows everything in this section.

### Moving around

- Scroll wheel and trackpad pinch zoom toward the pointer. Two-finger scroll pans. Space+drag and middle-button drag also pan. On touch screens, pinch zooms and two-finger drag pans.
- Zoom runs from 10% to 800%. Show the zoom level, with buttons for zoom in, zoom out, 100% and fit to content.
- Show a light grid in real units (1 ft or 0.5 m). Snap to it by default. Hold Alt to place freely.

### Adding and editing shapes

- Drag tables from the panel onto the canvas. Offer these presets, each a starting point we can resize:
  - Round: 60 in across, 8 seats
  - Square: 48 in, 8 seats
  - Rectangle: 8 ft by 30 in, 8 seats
  - Long head table: 24 ft by 30 in, 12 seats on one side
  - Sweetheart table: 36 in round, 2 seats side by side facing the room
- Drag in fixtures, each with a simple vector icon and an editable label: food station or buffet, bar, DJ booth, dance floor, stage, cake table, gift table, photo booth, plus plain rectangles, circles, lines and text.
- Click selects. Shift+click adds to or removes from the selection. Dragging on empty canvas draws a selection box.
- Drag to move. Arrow keys nudge by one grid step, Shift+arrow by five.
- A selected table shows corner and edge handles. Drag the end handle of a rectangle to stretch it into a long head table, or drag a corner inward to shrink any table down to a small sweetheart table. Hold Shift on a handle to keep proportions. Round tables stay round. The smallest table is 24 in across.
- Shift+drag on a table's body also resizes it about its center, keeping its proportions. Tell a Shift+click from a Shift+drag by whether the pointer moves more than 4 px.
- Resizing a table leaves its seat count alone. A Fit seats button sets the count to what the new size holds at 24 in of edge per seat.
- A rotate handle turns tables and fixtures, snapping to 15 degree steps unless Alt is held.
- Copy, paste, duplicate (Cmd/Ctrl+D), delete (Delete or Backspace), undo (Cmd/Ctrl+Z), redo (Cmd/Ctrl+Shift+Z), select all.
- Show alignment guides when an edge or center lines up with another shape. Add align and distribute buttons for a multi-selection.
- Lock shapes so they can't move by accident.
- Number new tables in order (Table 1, Table 2) and let us rename them.

### Seats

- Each seat is a small circle, all the same size, spaced evenly around a round table or along the sides of a square or rectangle table. A circle is dark blue when someone sits there and grey when the seat is empty. Use these two colors at every zoom level.
- A selected table shows a + and a − button beside it, large enough to tap on a phone. + adds a seat and − removes one, and the circles re-space evenly each time. The properties panel also has a seat count field.
- Square and rectangle tables have options for no seats at the ends and for one side only (head and sweetheart tables).
- If a table gets less than 24 in (61 cm) of edge per seat, outline it in yellow and say why in the panel. Do not block it.
- − removes an empty seat first. If every seat is taken, or a typed count would remove a seat with a guest in it, ask before unseating anyone, and move them to Unassigned.

### Space check

- While dragging a table, show the gap to its nearest neighbor in the wedding's unit. Flag gaps under 5 ft between table edges, since chairs and servers need room. Let us change that number.
- A Room panel shows total seats against guests who said yes or haven't answered, how many more tables of the most common size we would need, and the dance floor's area per guest.
- These are warnings only; they never block a change.

### Detail levels

What each table shows depends on how much screen space a seat gets. Pick the level from the size of a seat in screen pixels, so large and small tables switch at the same point.

1. Close: the dark blue and grey seat circles, with each guest's full name beside their circle. If a name doesn't fit, use first name and last initial, then shrink the text down to a 10 px minimum. Names sit on a line out from the table's center, turned so they never read upside down. The table shows its name and a count such as 6/8.
2. Middle: each dark blue circle shows the guest's initials in white. Empty circles stay grey.
3. Far: the table shows only its name and count, with its dark blue and grey circles and no text at the seats.

Switch levels at slightly different points when zooming in and zooming out, so labels don't flicker at the boundary. Fade between levels quickly.

### Seating guests

- Drag a name from the side list onto a seat, or onto a table to take its first free seat. On touch screens, press and hold a name to start the drag. Phones also get a second way: tap a name, then tap a seat.
- At the close and middle detail levels, each empty seat circle shows a small + in Edit mode. Tap or click it to open a short search list of unassigned guests, and pick one to seat them there. This is the quickest way to seat someone on a phone.
- While dragging, the empty circle under the pointer grows and gets an outline, so it is clear where the guest will land. Tables where their partner or group sits tint green, and tables where a rule would break tint red.
- Drag a seated guest to another seat to move them. Dropping onto a taken seat swaps the two guests. Dragging a guest back to the side list unseats them.
- Hover a seat (or tap it in View mode) for a card with the guest's name, groups, meal, notes and any rule problems.
- Click a table to list its guests in the right panel, where we can reorder them by dragging.

### Phones and desktops

The app must work well on both. Check every milestone at 390 px and 1440 px wide.

- On desktops, the side panels sit to the left and right of the canvas.
- On phones, the canvas fills the screen. The guest list and properties open in a bottom sheet we can drag up and down, and the shape panel opens from a button. Make every tap target at least 44 px.
- Phones have no Shift key or right click, so every edit must also work through handles, the + and − buttons and press-and-hold. Pressing and holding a seat or table opens the menu that right click opens on desktop.
- Pan and zoom must stay smooth with 40 tables, 400 seats and 100 other shapes, on a recent phone as well as a laptop.

## 5. Venues and blank canvas

When we create a layout, we pick a venue template or Blank canvas.

### Venue templates

- A template is a saved set of fixed items: room outlines, walls, doors, windows, columns, stairs, built-in bars, patio edges and named zones such as Main Room or Patio.
- Fixed items draw on a locked bottom layer. They belong to the venue, every layout that uses the template shares them, and only the template editor can change them.
- The template editor uses the same canvas plus drawing tools: click to place wall points and double-click to finish, drag rectangles for rooms, and drop door and window symbols that sit on walls. Type exact lengths where we know them.
- Floor plans come in through the AI import described next.
- Layouts point to their template, so a fixed wall shows up in every layout that uses it. If a template change puts a wall through a placed table, flag that table in each affected layout.
- Templates can be duplicated, renamed and deleted (with the same typed confirmation as layouts). Block deleting a template that layouts still use, and list those layouts.
- Adding a new venue must need no code change. We do it all in the template editor.

### Floor plan import with AI

Uploading a venue's floor plan turns it into editable vector shapes, so we never have to trace walls by hand unless the import gets something wrong. Read the current Anthropic docs on vision and structured outputs before building this.

1. In the template editor, upload a PNG, JPG or PDF of the floor plan.
2. If the PDF already holds vector drawing (most plans exported from design software do), read its paths with pdf.js and use those lines as the walls. This is more exact than reading a picture.
3. Send the image (or, for a vector PDF, the image plus the extracted lines) to the Anthropic API from a server route, using a current Claude model that reads images: `claude-sonnet-5-5` when this was written; check docs.claude.com for the latest. Keep the key in `ANTHROPIC_API_KEY`, on the server only.
4. Ask the model for JSON in the template's fixed item format: walls as point lists, rooms as named outlines, doors and windows with position and width, columns, built-in bars, stairs, and any dimension labels it can read. Force that shape with tool use or structured outputs, and check the reply with Zod before using it. Resize large images to fit the API's limits.
5. Set the scale from the dimension labels the model found. If it found none, ask us to click two points on the plan and type the real distance between them.
6. Open the result as a draft drawn over the faded original, so we can compare them line by line. Every shape stays editable. Highlight anything the model marked as unsure.
7. Nothing saves to the template until we press Accept. We can rerun the import or undo it at any time.

Keep the original image on a hidden layer we can turn on later to check against. It is the one raster image in the app.

### Toronto Beach Club

This is the first template. I will attach the venue's floor plan and room sizes. Run them through the floor plan import, check the draft against the original, and save it as the template so we can adjust it later in the template editor. If I have not attached them yet, seed an empty template named Toronto Beach Club and ask me for them. Do not guess the venue's layout.

### Blank canvas

A blank canvas layout has no venue layer: just the grid and every shape tool, like a plain Lucidchart page. Walls and room shapes are still in the panel there, as normal shapes we can move.

## 6. Guest list and CSV import

Guests live on the wedding's Guests page and are shared by all its layouts.

### Import

- Upload a CSV on the Guests page. Offer a sample file to download with these columns: `first_name, last_name, partner, household, side, groups, rsvp, meal, child, notes`. `partner` holds the partner's full name. `groups` holds group names split by semicolons, such as `Noa Family; Noa Cousins`.
- After upload, show a column matching step. Guess each column's match from its header, let us change any match, and preview the first 10 rows.
- Only first and last name are required. Put any unknown column's values into notes.
- Create any group named in the file that doesn't exist yet.
- Match partner names to guests in the file or already in the wedding. List any partner names that match no one, so we can fix them by hand.
- Flag likely duplicates (same name, or close spellings) for review.
- Re-importing: match rows to existing guests by first and last name, ignoring case and accents. Before saving, show a summary: how many are new, how many changed (with the changed fields), and how many are in the wedding but missing from the file. Let us choose whether to remove the missing ones. Removing a guest clears their seats in every layout, so the summary must name the layouts and tables that touches.

### Guests page

- A table we can sort, filter, search and edit in place. Add and delete guests by hand. Select many guests and add them to a group at once.
- Paste a list of names, one per line, to add guests without a CSV. Split each line into first and last name, and show the result for us to fix before saving.
- Export the guest list as CSV.

### Seated and unassigned

- The side list in the editor shows every guest for the current layout in two parts: Unassigned, and Seated with each guest's table name.
- Show counts at the top, such as "142 guests · 118 seated · 24 unassigned".
- A search box at the top of the list filters it as we type, matching first name, last name and nickname.
- Click or tap any seated name to pan and zoom the canvas to that guest's seat, which pulses for two seconds. This works in both Edit and View mode.
- Filter by group, side and RSVP. Guests who answered no are hidden from Unassigned by default.
- Names in this list are what we drag onto tables (section 4).

## 7. Seating rules and named groups

### Rules

- Together: these guests must sit at the same table, with an option for next to each other.
- Apart: these guests must not sit at the same table.
- A rule names two or more guests. When picking guests, we can add all members of a group at once.
- Couples: every pair linked as partners gets an implied rule to sit together and next to each other. These show in the rules list as couple rules, and each can be switched off.
- Add rules on the Rules page, or select seated guests on the canvas and right-click for Keep together or Keep apart.
- Rules never block a move. A broken rule puts a red badge on the table and the seats involved, adds to a count in the top bar ("3 seating problems"), and appears in a Problems list. Clicking a problem pans to it.
- If only some guests in a together rule are seated, mark it grey as unfinished. It is not a problem yet.
- If the same guests have both a together rule and an apart rule, flag the clash on the Rules page.
- In ceremony layouts, "same table" means "same row", and rules apply only to guests seated by name.
- Check rules on every change. It must take under 16 ms for 400 guests.

### Groups

- Named groups such as "Aiden HS Friends" or "Noa Family", each with a color. A guest can be in many groups.
- Manage groups on the Groups page. Add members from the guest table, or by selecting seats on the canvas.
- In the editor, pick one to three groups to show. Their seated members get a ring in the group color and everyone else fades.

### Closeness score

For each group in a layout, show how tightly its seated members sit together. Count only seated members; list the unseated ones beside the score.

- Tables used: how many tables the seated members sit at.
- Fewest tables possible: fill the layout's largest tables first, in order, until there are enough seats for the seated members. Count those tables.
- Tightness: fewest tables possible divided by tables used, shown as a percent. 100% means the group could not sit any closer.
- Spread: the average distance between table centers over every pair of seated members, counting 0 for two people at the same table, in the wedding's unit.

Show each group as one line, for example: "Aiden HS Friends · 11 of 12 seated · 3 tables (2 possible) · 67% tight · 9 ft spread". Sort the Groups tab loosest first. Explain each number in a tooltip in plain words. Clicking a group highlights it on the canvas.

## 8. Ceremony layouts

A ceremony layout uses the same editor, venue templates, detail levels and saving. Only the shape panel and seating unit change.

- Seating block tool: set rows, chairs per row, aisle width and side labels, and it places two blocks of chair rows either side of an aisle. Defaults: 20 in per chair, 36 in from one row to the next, 6 ft aisle, sides labeled "Noa's side" and "Aiden's side". Each row can also be added, moved and edited on its own.
- Number rows from the front.
- Fixtures: ceremony structure with an editable label (arch, chuppah, altar or anything else), officiant spot, aisle runner, musicians, sound desk, welcome sign, entrance.
- Seat guests on specific chairs, or reserve a whole row with a label such as "Family, row 1" without naming anyone. Most guests will not have assigned ceremony seats, so this is optional.
- Show total chairs against guests who answered yes, so we know whether there are enough.
- A ceremony layout can use the reception's venue template (for a lawn or beach zone), another template, or a blank canvas.

## 9. Annotations

- Tools: sticky note, text, arrow, line, box and circle, in six preset colors.
- Notes sit on their own layer above the furniture. One button shows or hides them all; another locks them.
- Since there are no accounts, put a Noa / Aiden switch in the top bar. Each new note records who wrote it, and the layouts list shows who edited last.
- An arrow can attach to a table or fixture at either end and follow it when it moves.
- A Notes tab in the right panel lists every note. Clicking one pans to it. Marking a note done greys it out.
- Exports include notes, with an option to leave them out.

## 10. Weddings, layouts, saving and deleting

### Screens

- Home: a card for each wedding with its name, date, guest count and layout count. Create, open, rename and delete weddings here.
- Wedding: tabs for Layouts, Guests, Groups, Rules and Venues.
- Layouts tab: each layout shows a small preview, its name, kind (reception or ceremony), venue, when it was last edited and by whom. Create (pick kind, then venue or blank), open, rename, duplicate and delete layouts here.
- Duplicate copies a layout with all its tables, seats and notes, so we can try a new idea without losing the old one.

### Renaming

Click a wedding, layout or template name to edit it in place. Enter saves and Esc cancels. Names can't be empty.

### Saving

- Save every change on its own, about one second after the last edit. Show Saving, Saved, or Not saved, retrying in the top bar.
- Keep unsaved changes in IndexedDB so a reload or dropped connection loses nothing, and retry until the save lands. Warn before closing the tab if changes are still unsaved.
- Each layout save sends the version it started from. If the server has a newer version (the other person edited the same layout), do not overwrite it. Show who changed it and offer two choices: load their version, or keep mine as a new copy.
- Save guest, group and rule edits one row at a time so they rarely clash.

### Deleting

The same steps apply to weddings, layouts and venue templates.

1. Open a dialog that names the item and says everything that goes with it, such as: "Delete the wedding 'Noa & Aiden'? This also deletes 6 layouts, 142 guests, 9 groups and 14 rules."
2. The person types `delete` (lower case, exactly) into a box. The red Delete button stays disabled until they do.
3. Only then does Delete work.

Mark deleted rows with `deletedAt` and hide them everywhere in the app, so a mistake can still be undone from the database.

## 11. Export and backup

- Floor plan as PDF and SVG. Options: detail level (full names, initials, or table names only), include notes or not, Letter or Tabloid paper, landscape.
- Table list for the venue: each table with its guests, as PDF and CSV.
- Escort card list: every seated guest sorted by last name with their table number, as PDF and CSV.
- Ceremony: reserved rows and any named seats, as PDF.
- Backup: download a whole wedding (guests, groups, rules, layouts, templates) as one JSON file, and restore from that file as a new wedding.

## 12. How to work and build order

- Read this whole prompt first. Then write `PLAN.md` with the schema, folder layout and any changes you suggest to this spec. Show it to me and wait for my OK before writing app code.
- Build in the milestones below. At the end of each one, run the tests, commit with a plain message saying what changed and why, and tell me how to try it. Then start the next.
- When this prompt is unclear, ask me. When it says nothing, pick the simpler option and log it in `DECISIONS.md`.
- Keep geometry, seat placement, rule checks, closeness scores and CSV parsing in plain TypeScript modules with unit tests, apart from React.
- Write a seed script that makes a demo wedding with about 120 made-up guests, 8 groups, 20 couples and 5 rules, so every feature can be tried without real data. Never commit real guest data.

### Milestones

1. Setup: repo, password gate, database, first deploy to Vercel. Done when the public URL shows the password page and the right password opens an empty home screen.
2. Weddings and layouts: create, open, rename, duplicate, delete with typed confirmation, autosave, conflict check.
3. Canvas: pan, zoom, grid, shape panel, tables and fixtures, select, move, resize (with Shift+drag and handles), rotate, alignment guides, undo and redo, Edit and View modes, phone layout.
4. Guests: CSV import with column matching and re-import summary, Guests page, seated and unassigned lists.
5. Seating: drag guests to seats, seat counts, detail levels, hover cards, search.
6. Rules and groups: rule checks and problem badges, group highlight, closeness scores.
7. Venues: template editor, floor plan import with AI, Toronto Beach Club template, blank canvas.
8. Ceremony layouts.
9. Annotations.
10. Exports, backup and restore, venue share links.

## 13. Acceptance checks

The finished app must pass each of these. Turn them into Playwright or Vitest tests where you can.

- [ ] The public URL in a private window shows the password page. A wrong password shows an error. The right one opens the app, and it stays open after the browser restarts.
- [ ] No page or API route returns data without the cookie. The password appears nowhere in the browser bundle or the git history.
- [ ] Noa adds a table on her laptop; Aiden reloads on his phone and sees it.
- [ ] On a phone the app opens in View mode, and dragging on the canvas pans without moving anything. Switching to Edit allows changes. On a laptop it opens in Edit mode.
- [ ] Typing part of a name in the side list search and clicking the result pans to that guest's seat, on a phone and on a laptop.
- [ ] Dragging a name from the side list onto a table seats the guest, and their circle turns dark blue. Unseating them turns it grey.
- [ ] Pressing + on an 8-seat round table gives 9 evenly spaced circles.
- [ ] Zooming a 10-seat table from 800% to 10% shows full names, then initials, then circles only, with no flicker at the switch points.
- [ ] Shapes and text stay sharp at 800%.
- [ ] Stretching a rectangle by its end handle to 24 ft and pressing Fit seats gives 12 seats on one side. Shrinking a round table to 36 in and setting 2 seats makes a sweetheart table.
- [ ] A round table grows and shrinks about its center with Shift+drag. Shift+click without dragging still changes the selection.
- [ ] Setting a table to 12 seats spaces 12 seats evenly. Dropping it to 8 with 10 guests seated asks before unseating 2.
- [ ] Importing the sample CSV twice creates no duplicates; the second import reports 0 new.
- [ ] Seating partners at different tables shows a problem on both tables.
- [ ] An apart rule between two guests at the same table shows a problem, and moving one away clears it.
- [ ] In a layout where no table seats more than 10, a group of 12 seated across two tables scores 100% tight.
- [ ] Delete stays disabled until `delete` is typed. After deleting a layout, the wedding's other layouts are unchanged.
- [ ] Two tabs editing the same layout: the second save warns instead of overwriting.
- [ ] Closing the tab right after an edit and reopening shows that edit.
- [ ] The exported PDF floor plan prints with readable names at full-name detail.
- [ ] A venue share link asks for its own password. That password opens only that one layout in View mode, and turning the link off signs the viewer out.
- [ ] Uploading a floor plan image returns an editable vector draft over the faded original, and nothing changes in the template until Accept is pressed.
- [ ] A vector PDF floor plan imports its walls from the PDF's own lines.
- [ ] Tapping the + on an empty seat on a phone lists unassigned guests, and picking one seats them.
- [ ] Pasting 10 names, one per line, adds 10 guests after a preview.
- [ ] Dragging a table within 5 ft of another shows the gap and a warning, and still lets the move happen.
- [ ] With 40 tables and 400 seats, pan and zoom stay smooth on a mid-range laptop and a recent phone.
