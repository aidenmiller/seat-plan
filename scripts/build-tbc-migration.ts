/**
 * Writes drizzle/0004_toronto_beach_club_fixed_items.sql from a traced fixed
 * item list (JSON). Checks every item with the app's schema first.
 *
 *   npx tsx scripts/build-tbc-migration.ts <fixed-items.json>
 *
 * The migration fills the Toronto Beach Club template only while it is still
 * empty, and records two revisions (the empty state, then the import) so
 * "Undo import" can go back to the empty template.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fixedItemsSchema } from '../src/domain/venue-schema'

const source = process.argv[2]
if (!source) {
  console.error('Usage: npx tsx scripts/build-tbc-migration.ts <fixed-items.json>')
  process.exit(1)
}

const items = fixedItemsSchema.parse(JSON.parse(readFileSync(source, 'utf8')))
const json = JSON.stringify(items).replaceAll("'", "''")

const sql = `-- The Toronto Beach Club venue, traced from the venue's marketing floor plan
-- (two independent tracings, reconciled and checked against the plan).
-- Scale: 4.80 cm per plan pixel, set from the Mediterranean Room's 3,500 sq ft.
-- ${items.length} fixed items; ${items.filter((i) => i.unsure).length} are marked unsure for the owners to check.
-- Fills the template only while it is still empty, so it never overwrites edits.
--> statement-breakpoint
INSERT INTO "venue_template_revisions" ("template_id", "fixed_items", "reason")
SELECT "id", '[]'::jsonb, 'save' FROM "venue_templates"
WHERE "name" = 'Toronto Beach Club' AND "deleted_at" IS NULL AND "fixed_items" = '[]'::jsonb;
--> statement-breakpoint
UPDATE "venue_templates"
SET "fixed_items" = '${json}'::jsonb,
    "imported_by" = 'ai',
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "name" = 'Toronto Beach Club' AND "deleted_at" IS NULL AND "fixed_items" = '[]'::jsonb;
--> statement-breakpoint
INSERT INTO "venue_template_revisions" ("template_id", "fixed_items", "reason")
SELECT "id", "fixed_items", 'import' FROM "venue_templates"
WHERE "name" = 'Toronto Beach Club' AND "deleted_at" IS NULL
  AND "imported_by" = 'ai'
  AND NOT EXISTS (
    SELECT 1 FROM "venue_template_revisions" r
    WHERE r."template_id" = "venue_templates"."id" AND r."reason" = 'import'
  );
`

writeFileSync('drizzle/0004_toronto_beach_club_fixed_items.sql', sql)
console.log(`Wrote the migration with ${items.length} items.`)
