/**
 * The PDF options the import opens plans with: the copied decoders match the
 * pinned pdfjs-dist, and with them a CCITT fax scan renders its picture
 * instead of a white page (pdf.js skips an image it cannot decode, with no
 * error, so the page would reach the model blank).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeCcittScanPdf } from '@/domain/floorplan/__fixtures__/plans'
import { loadPdfjs } from '@/domain/floorplan/__fixtures__/pdfjs-node'
import { classifyPage, isBlankPicture } from '@/domain/floorplan/raster-detect'
import { readPdfPage } from '@/domain/floorplan/pdf-vectors'
import { PDFJS_WASM_FILES, PDFJS_WASM_URL, planDocumentParams } from './pdfjs-options'

const root = path.resolve(import.meta.dirname, '../../../..')
const served = path.join(root, 'public', PDFJS_WASM_URL.replaceAll('/', '')) + path.sep
const installed = path.join(root, 'node_modules', 'pdfjs-dist', 'wasm')
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

describe('the pdf.js decoders the app serves', () => {
  it('are the ones in the installed pdfjs-dist (run npm run pdfjs:wasm after an upgrade)', () => {
    const version = (JSON.parse(readFileSync(path.join(root, 'node_modules', 'pdfjs-dist', 'package.json'), 'utf8')) as { version: string }).version
    expect(readFileSync(path.join(served, 'VERSION'), 'utf8').trim()).toBe(version)
    for (const name of PDFJS_WASM_FILES) expect(hash(path.join(served, name)), name).toBe(hash(path.join(installed, name)))
  })

  it('are asked for under /pdfjs-wasm/, with the trailing slash pdf.js needs', () => {
    const data = new Uint8Array([1])
    expect(planDocumentParams(data, 0)).toEqual({ data, verbosity: 0, wasmUrl: '/pdfjs-wasm/' })
  })
})

/** Renders page 1 the way the browser does, with the given wasmUrl (or none), and reads its pixels. */
async function render(pdf: Uint8Array, wasmUrl: string | null) {
  const pdfjs = await loadPdfjs()
  const { createCanvas } = await import('@napi-rs/canvas')
  const params = planDocumentParams(pdf.slice(), pdfjs.VerbosityLevel.ERRORS, wasmUrl ?? undefined)
  const task = pdfjs.getDocument(wasmUrl === null ? { data: params.data, verbosity: params.verbosity } : params)
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: 0.5 })
    const width = Math.floor(viewport.width)
    const height = Math.floor(viewport.height)
    const canvas = createCanvas(width, height)
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: '#ffffff' }).promise
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
    const vectors = await readPdfPage(pdfjs, page, { scale: 0.5 })
    return { pixels, centre: Array.from(pixels.slice(((height >> 1) * width + (width >> 1)) * 4, ((height >> 1) * width + (width >> 1)) * 4 + 3)), kind: classifyPage(vectors).kind }
  } finally {
    await task.destroy()
  }
}

describe('a CCITT fax scan', () => {
  // One test, in this order: once pdf.js has loaded a decoder it keeps it for the process.
  it('renders white without the decoders (refused as blank), and its picture with the served ones', async () => {
    const pdf = await makeCcittScanPdf()
    const without = await render(pdf, null)
    expect(without.kind).toBe('raster')
    expect(isBlankPicture(without.pixels)).toBe(true)

    const withDecoders = await render(pdf, served)
    expect(withDecoders.kind).toBe('raster')
    expect(withDecoders.centre).toEqual([0, 0, 0])
    expect(isBlankPicture(withDecoders.pixels)).toBe(false)
  }, 20_000)
})
