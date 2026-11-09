# Acceptance checks

The 27 checks from spec section 13, the tests that cover them, and their state. "You" means a check a person makes on a real device. Updated at the end of every milestone.

| # | Check | Tests | Milestone | State |
|---|---|---|---|---|
| 1 | Password page in a private window; wrong password errors; right one opens and survives a browser restart | `e2e/auth.spec.ts`, `src/server/auth/tokens.test.ts`, `src/server/auth/require.test.ts`, `src/app/api/auth/login/route.int.test.ts` | 1 | Passing. You: confirm on the live site after a real browser restart. |
| 2 | No page or route returns data without the cookie; password not in the bundle or git history | `e2e/signed-out.spec.ts`, `src/proxy.test.ts`, `src/server/auth/route-auth.test.ts`, `src/server/auth/page-auth.test.ts`, `scripts/check-secrets.ts` (build output in the Vercel build; git history before every push, and in CI once the `SITE_PASSWORD_REAL` secret exists) | 1, grows each milestone | Passing |
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
| 17 | Delete stays disabled until `delete` is typed; other layouts are unchanged after a layout delete | `e2e/delete.spec.ts`, server test that other layouts keep their version and canvas | 2 | |
| 18 | Two tabs on one layout: the second save warns | `e2e/conflict.spec.ts` (both tabs edit before either saves), server test for the 409 reply | 2 | |
| 19 | Closing the tab right after an edit and reopening shows the edit | `e2e/close-tab.spec.ts` | 2 | |
| 20 | The exported floor plan PDF prints with readable names at full-name detail | `e2e/export.spec.ts` | 10 | You: print one page |
| 21 | A share link asks its own password, opens only that layout in View, and turning it off signs the viewer out | `e2e/share.spec.ts` | 10 | |
| 22 | An uploaded floor plan image returns an editable vector draft over the faded original; nothing changes until Accept | `e2e/venue-import.spec.ts` | 7 | |
| 23 | A vector PDF imports its walls from the PDF's own lines | `src/domain/floorplan/pdf-vectors.test.ts`, `e2e/venue-import.spec.ts` | 7 | |
| 24 | Tapping + on an empty seat on a phone lists unassigned guests; picking one seats them | `e2e/seat-plus.spec.ts` | 5 | |
| 25 | Pasting 10 names adds 10 guests after a preview | `src/domain/names.test.ts`, `e2e/paste-names.spec.ts` | 4 | |
| 26 | Dragging a table within 5 ft of another shows the gap and a warning, and the move still happens | `src/domain/spacing.test.ts`, `e2e/space-check.spec.ts` | 3 | |
| 27 | 40 tables and 400 seats pan and zoom smoothly on a laptop and a phone | `e2e/perf.spec.ts` | 3, 5, 10 | You: try on your phones |
