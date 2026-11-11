/**
 * Builds the SQL migration that adds a shared-library venue template from a
 * JSON spec. The spec is checked with the app's own schemas first.
 *
 *   npx tsx scripts/build-template-migration.ts <spec.json> <out.sql>
 *
 * The SQL is idempotent: the template is inserted only when its id is not
 * there yet and no live template has the same name (so it never clobbers a
 * planner's own venue), and its first revision is added only once. The
 * template has no owner (owner_user_id stays null), as a library template should.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { fixedItemsSchema } from '../src/domain/venue-schema'

export const templateSeedSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  library: z.literal(true),
  importedBy: z.literal('hand'),
  header: z.array(z.string()),
  sources: z.array(z.string()),
  fixedItems: fixedItemsSchema,
})

export type TemplateSeed = z.infer<typeof templateSeedSchema>

const BREAKPOINT = '--> statement-breakpoint'

/** One SQL string literal body: every single quote doubled. */
function esc(text: string): string {
  return text.replaceAll("'", "''")
}

/** A comment line that cannot break out of the comment (no line breaks). */
function comment(line: string): string {
  return `-- ${line.replace(/\s*[\r\n]+\s*/g, ' ')}`
}

export function templateSeedSql(spec: TemplateSeed): string {
  const parsed = templateSeedSchema.parse(spec)
  const id = esc(parsed.id)
  const name = esc(parsed.name)
  const json = esc(JSON.stringify(parsed.fixedItems))
  const unsure = parsed.fixedItems.filter((i) => i.unsure).length
  const lines = [
    ...parsed.header.map(comment),
    comment(`${parsed.fixedItems.length} fixed items; ${unsure} are marked unsure.`),
    ...(parsed.sources.length > 0 ? [comment('Sources:'), ...parsed.sources.map((s) => comment(`  ${s}`))] : []),
  ]
  return `${lines.join('\n')}
${BREAKPOINT}
INSERT INTO "venue_templates" ("id", "name", "fixed_items", "imported_by", "is_library", "version")
SELECT '${id}'::uuid, '${name}', '${json}'::jsonb, '${parsed.importedBy}', true, 1
WHERE NOT EXISTS (SELECT 1 FROM "venue_templates" WHERE "id" = '${id}'::uuid)
  AND NOT EXISTS (SELECT 1 FROM "venue_templates" WHERE "name" = '${name}' AND "deleted_at" IS NULL);
${BREAKPOINT}
INSERT INTO "venue_template_revisions" ("template_id", "fixed_items", "reason")
SELECT "id", "fixed_items", 'save' FROM "venue_templates" WHERE "id" = '${id}'::uuid
  AND NOT EXISTS (SELECT 1 FROM "venue_template_revisions" WHERE "template_id" = '${id}'::uuid);
`
}

function main(): void {
  const [specPath, outPath] = process.argv.slice(2)
  if (!specPath || !outPath) {
    console.error('Usage: npx tsx scripts/build-template-migration.ts <spec.json> <out.sql>')
    process.exit(1)
  }
  const spec = templateSeedSchema.parse(JSON.parse(readFileSync(specPath, 'utf8')))
  writeFileSync(outPath, templateSeedSql(spec))
  console.log(`Wrote ${outPath} with ${spec.fixedItems.length} items.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
