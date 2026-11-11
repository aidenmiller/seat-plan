import { describe, expect, it } from 'vitest'
import { templateSeedSchema, templateSeedSql, type TemplateSeed } from './build-template-migration'

const spec: TemplateSeed = {
  id: '6e06640e-fb98-49ef-b9f7-4a2ea4bb92bd',
  name: "Governor's Room",
  library: true,
  importedBy: 'hand',
  header: ['A test template.', 'Approximate.'],
  sources: ['https://example.com/plan.pdf'],
  fixedItems: [
    {
      id: 'w1',
      type: 'wall',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      thickness: 30,
      unsure: true,
      unsureNote: "It's a guess",
    },
  ],
}

describe('templateSeedSql', () => {
  it('doubles every single quote in the name and the JSON', () => {
    const sql = templateSeedSql(spec)
    expect(sql).toContain("'Governor''s Room'")
    expect(sql).toContain("It''s a guess")
    expect(sql).not.toMatch(/Governor's/)
  })

  it('guards both inserts so a second run changes nothing', () => {
    const sql = templateSeedSql(spec)
    const parts = sql.split('--> statement-breakpoint')
    expect(parts).toHaveLength(3)
    expect(parts[1]).toContain(`WHERE NOT EXISTS (SELECT 1 FROM "venue_templates" WHERE "id" = '${spec.id}'::uuid)`)
    expect(parts[1]).toContain(`"deleted_at" IS NULL`)
    expect(parts[1]).toContain('true, 1')
    expect(parts[2]).toContain(`NOT EXISTS (SELECT 1 FROM "venue_template_revisions" WHERE "template_id" = '${spec.id}'::uuid)`)
    expect(sql).not.toContain('owner_user_id')
  })

  it('writes the header and sources as comments', () => {
    const sql = templateSeedSql(spec)
    expect(sql.startsWith('-- A test template.\n-- Approximate.\n')).toBe(true)
    expect(sql).toContain('--   https://example.com/plan.pdf')
  })

  it('is deterministic', () => {
    expect(templateSeedSql(spec)).toBe(templateSeedSql(structuredClone(spec)))
  })

  it('rejects a bad spec', () => {
    expect(() => templateSeedSql({ ...spec, id: 'nope' })).toThrow()
    expect(() => templateSeedSql({ ...spec, library: false as never })).toThrow()
    const badItem = { ...spec.fixedItems[0]!, thickness: -1 }
    expect(templateSeedSchema.safeParse({ ...spec, fixedItems: [badItem] }).success).toBe(false)
  })
})
