/**
 * One real call to the Anthropic API with the floor plan import's exact
 * request: the JSON schema, effort, the image settings and the model from
 * FLOORPLAN_MODEL (default claude-sonnet-5-5). The tests only ever talk to a
 * stand-in, so run this once before relying on the import, and again after
 * changing the schema or the model:
 *
 *   ANTHROPIC_API_KEY must be set in the environment (never on the command line).
 *   npx tsx --conditions=react-server scripts/check-floorplan-api.ts
 *
 * It sends a made-up grid picture (no real plan), prints the last line the
 * import route would send (a draft or a plain error), and exits 1 on an
 * error. A refused schema shows as "The AI service refused the request",
 * with the API's reason in the log line above it. Costs a few cents.
 */
import { makeGridPng } from '../src/domain/floorplan/__fixtures__/plans'
import { floorplanImportStream, floorplanModel, importConfigured } from '../src/server/ai/floorplan-import'
import type { FloorplanImportLine } from '../src/shared/api'

async function main() {
  if (!importConfigured()) {
    console.error('ANTHROPIC_API_KEY is not set in the environment.')
    process.exit(1)
  }
  const width = 800
  const height = 600
  const stream = floorplanImportStream({ image: { contentType: 'image/png', bytes: makeGridPng(width, height) }, prompt: { width, height, kind: 'raster' } })
  const text = await new Response(stream).text()
  const lines = text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FloorplanImportLine)
  const last = lines.at(-1)
  console.log(`Model: ${floorplanModel()}`)
  if (last?.type === 'draft') {
    console.log(`Draft accepted by the schema check: ${last.draft.walls.length} walls, ${last.draft.rooms.length} rooms, ${last.outputTokens} output tokens.`)
    return
  }
  console.error(last?.type === 'error' ? `${last.code}: ${last.message}` : 'No final line came back.')
  process.exit(1)
}

void main()
