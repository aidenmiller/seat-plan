# Acceptance checks

The 27 checks from spec section 13, the tests that cover them, and their state. "You" means a check a person makes on a real device. Updated at the end of every milestone.

| # | Check | Tests | Milestone | State |
|---|---|---|---|---|
| 1 | Password page in a private window; wrong password errors; right one opens and survives a browser restart | `e2e/auth.spec.ts`, `src/server/auth/tokens.test.ts`, `src/server/auth/require.test.ts`, `src/app/api/auth/login/route.int.test.ts` | 1 | Passing. You: confirm on the live site after a real browser restart. |
| 2 | No page or route returns data without the cookie; password not in the bundle or git history | `e2e/signed-out.spec.ts` (every page and API route so far, with made-up ids and with a real wedding and layout whose names must not appear; the editor and wedding pages in the password scan), `src/proxy.test.ts`, `src/server/auth/route-auth.test.ts`, `src/server/auth/page-auth.test.ts`, `scripts/check-secrets.ts` (build output in the Vercel build; git history before every push, and in CI once the `SITE_PASSWORD_REAL` secret exists) | 1, grows each milestone | Passing |
| 3 | Noa adds a table on a laptop; Aiden reloads on a phone and sees it | `e2e/two-devices.spec.ts` | 3 | |
| 4 | Phone opens in View; drag pans without moving anything; Edit allows changes; laptop opens in Edit | `e2e/modes.spec.ts` | 3 | |
| 5 | Search a name, click it, the canvas pans to the seat (phone and laptop) | `e2e/search.spec.ts` | 5 | |
| 6 | Dragging a name onto a table seats them (dark blue); unseating turns the circle grey | `e2e/seating.spec.ts` | 5 | |
| 7 | + on an 8-seat round gives 9 evenly spaced circles | `src/domain/seats.test.ts`, `e2e/seat-count.spec.ts` | 3 | |
| 8 | Zooming a 10-seat table from 800% to 10% shows names, initials, then circles, with no flicker | `src/domain/detail-level.test.ts`, `e2e/detail-levels.spec.ts` | 5 | |
| 9 | Shapes and text stay sharp at 800% | `e2e/sharpness.spec.ts` | 3 | You: check on an iPhone |
| 10 | Rect stretched to 24 ft plus Fit seats gives 12 on one side; round shrunk to 36 in with 2 seats is a sweetheart table | `src/domain/seats.test.ts`, `e2e/resize.spec.ts` | 3 | |
| 11 | Shift+drag resizes a round table about its center; Shift+click still changes the selection | `e2e/resize.spec.ts`, pointer handler tests | 3 | |
| 12 | 12 seats spaced evenly; dropping to 8 with 10 seated asks before unseating 2 | `src/domain/seats.test.ts`, `e2e/seat-count.spec.ts` | 3, 5 | |
| 13 | Importing the sample CSV twice makes no duplicates; the second import reports 0 new | `src/domain/csv/import-diff.test.ts`, `e2e/csv-import.spec.ts` | 4 | |
| 14 | Partners at different tables show a problem on both tables | `src/domain/rules.test.ts`, `e2e/rules.spec.ts` | 6 | |
| 15 | An apart rule at one table shows a problem; moving one guest clears it | `src/domain/rules.test.ts`, `e2e/rules.spec.ts` | 6 | |
| 16 | No table over 10 seats; a group of 12 over two tables scores 100% tight | `src/domain/closeness.test.ts`, `e2e/groups.spec.ts` | 6 | |
| 17 | Delete stays disabled until `delete` is typed; other layouts are unchanged after a layout delete | `e2e/delete.spec.ts` (`Delete`, `DELETE`, `delet`, `delete `, ` delete` and Enter leave it disabled; after deleting one of three layouts the other two reopen with the same names and table counts, and keep their version, canvas and last edited time; a deleted wedding's card, API and pages are gone, other weddings stay), `src/server/repo/layouts.int.test.ts` (other layouts keep their version and canvas) | 2 | Passing |
| 18 | Two tabs on one layout: the second save warns | `e2e/conflict.spec.ts` (two tabs in one browser, saves held until both have edited; the second save shows "Aiden changed this layout from another tab or device at ..." and says "Load their version to drop your changes here, or keep yours as a new copy of this layout."; "Keep mine as a new copy" opens "Plan (Aiden's copy)" with the second tab's table; "Load their version" shows the first tab's tables, drops the second tab's, and editing goes on from them), `e2e/close-tab.spec.ts` (an edit left by a closed tab meets Aiden's newer save: the dialog says loading theirs drops the changes made on this device earlier, and after Load their version a reload asks nothing), `src/server/canvas-write.int.test.ts` and `src/app/api/layouts/[id]/route.int.test.ts` (409 naming who saved), `src/client/editor/layout-session.test.ts` | 2 | Passing. You: try it with a laptop and a phone signed in as Noa and Aiden. |
| 19 | Closing the tab right after an edit and reopening shows the edit | `e2e/close-tab.spec.ts` (the device is offline, so no save can leave; the tab closes within 200 ms of the edit and the server still has version 1 half a second later; a new tab shows the edit, then Saved, and the server has it. Online, the last-chance keepalive save sent as the tab closes lands on its own, and reopening asks nothing), `src/client/sync/recovery.test.ts`, `src/client/sync/layout-saver.test.ts`, `src/client/sync/unload.test.ts` | 2 | Passing. You: on an iPhone, add a table, close the tab at once, reopen the layout. |
| 20 | The exported floor plan PDF prints with readable names at full-name detail | `e2e/export.spec.ts` | 10 | You: print one page |
| 21 | A share link asks its own password, opens only that layout in View, and turning it off signs the viewer out | `e2e/share.spec.ts` | 10 | |
| 22 | An uploaded floor plan image returns an editable vector draft over the faded original; nothing changes until Accept | `e2e/venue-import.spec.ts` | 7 | |
| 23 | A vector PDF imports its walls from the PDF's own lines | `src/domain/floorplan/pdf-vectors.test.ts`, `e2e/venue-import.spec.ts` | 7 | |
| 24 | Tapping + on an empty seat on a phone lists unassigned guests; picking one seats them | `e2e/seat-plus.spec.ts` | 5 | |
| 25 | Pasting 10 names adds 10 guests after a preview | `src/domain/names.test.ts`, `e2e/paste-names.spec.ts` | 4 | |
| 26 | Dragging a table within 5 ft of another shows the gap and a warning, and the move still happens | `src/domain/spacing.test.ts`, `e2e/space-check.spec.ts` | 3 | |
| 27 | 40 tables and 400 seats pan and zoom smoothly on a laptop and a phone | `e2e/perf.spec.ts` | 3, 5, 10 | You: try on your phones |

## Other end-to-end checks

| What | Tests | Milestone |
|---|---|---|
| The editor's top bar keeps its height, and the canvas stays put, while the status goes from Saving to Saved and through Not saved, retrying (390 px and 1440 px) | `e2e/editor-header.spec.ts` | 2 |
| A layout deleted on another device while open: the next save fails with "Couldn't save: this layout was deleted", or the banner shows when the tab regains focus; Save as a copy opens "Plan (Noa's copy)" holding the tables, and editing goes on there | `e2e/deleted-layout.spec.ts` | 2 |
| Wedding settings open on what was just saved, even before the page's data refreshes | `e2e/weddings.spec.ts`, `src/app/(app)/w/[weddingId]/_components/WeddingHeader.test.tsx` | 2 |

## Notes for writing these tests

- Chromium sends a `keepalive` request after its page is gone, and `page.route()` does not reliably see it: sometimes it goes straight through, sometimes it is held and dropped. To keep every save from a closing tab off the server, take the context offline (`context.setOffline(true)`); never rely on a route.
- A name renamed in place shows at once, before the server has it. Wait for the PATCH reply before a reload or an API read.
