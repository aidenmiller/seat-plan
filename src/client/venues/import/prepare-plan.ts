/**
 * Reads a floor plan file in the browser (spec section 5 steps 1 and 2; PLAN
 * change 6 and section 7 "Floor plan import"), before anything is uploaded:
 *
 *  - A PDF loads pdf.js (the legacy build, for Safari) only when needed. The
 *    chosen page is rendered to a PNG at the largest size the model reads
 *    without shrinking (pageRenderScale), with the page's own rotation and
 *    crop. The page is classed as vector drawing or a scan; for a vector
 *    page its lines are read in the same pixels, picked and cleaned
 *    (cleanup.ts), its text read, its door swings found and its dimension
 *    texts paired with the lines they measure.
 *  - A PNG or JPG is redrawn at that size too (EXIF rotation applied), as a
 *    PNG, or a JPEG when that is what keeps it under about 3 MB.
 * A picture that still comes out too large is shrunk until it fits, and a
 * PDF page is then read again at the smaller size so its lines still match.
 *
 * PDFs open with the image decoders pdf.js loads from wasmUrl
 * (pdfjs-options.ts), so JBIG2, CCITT fax and JPEG 2000 scans render. A
 * scanned page that still renders blank is refused before anything is
 * uploaded or sent to the model.
 */
import { doorSwingHints, extractWallSegments } from '@/domain/floorplan/cleanup'
import { pageRenderScale, shrinkForBytes, storedImageSize, STORED_TARGET_BYTES, type Size } from '@/domain/floorplan/image-size'
import { readPdfPage } from '@/domain/floorplan/pdf-vectors'
import { classifyPage, isBlankPicture } from '@/domain/floorplan/raster-detect'
import { measureDimensionLines } from '@/domain/floorplan/scale'
import { MAX_VENUE_IMAGE_BYTES } from '@/shared/api'
import type { ImportPlan } from './plan-body'
import { planDocumentParams } from './pdfjs-options'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfDocument = Awaited<ReturnType<Pdfjs['getDocument']>['promise']>
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>

/** A plan ready to upload: the picture and what was read off it. */
export type PreparedPlan = ImportPlan & {
  blob: Blob
  source: 'image' | 'pdf'
  /** The PDF page it came from (1 based), or null for an image. */
  page: number | null
  fileName: string
}

export class PlanReadError extends Error {}

let loading: Promise<Pdfjs> | null = null

/** pdf.js, loaded the first time a PDF is picked. Its worker comes from the bundle (Next emits it as a static file). */
export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= import('pdfjs-dist/legacy/build/pdf.mjs')
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
      return pdfjs
    })
    .catch((err: unknown) => {
      loading = null
      throw err
    })
  return loading
}

/** An open PDF: its page count, and close() to free it. */
export type OpenPdf = { pdfjs: Pdfjs; doc: PdfDocument; pages: number; close(): void }

export async function openPdf(file: Blob): Promise<OpenPdf> {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument(planDocumentParams(data, pdfjs.VerbosityLevel.ERRORS))
  try {
    const doc = await task.promise
    return { pdfjs, doc, pages: doc.numPages, close: () => void task.destroy() }
  } catch {
    void task.destroy()
    throw new PlanReadError('This PDF could not be opened. It may be damaged or need a password.')
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PlanReadError('The browser could not make the picture.'))), type, quality)
  })
}

function newCanvas(size: Size): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  return canvas
}

async function renderPage(pdfjs: Pdfjs, page: PdfPage, scale: number): Promise<{ blob: Blob; size: Size; blank: boolean }> {
  const viewport = page.getViewport({ scale })
  const size = { width: Math.floor(viewport.width), height: Math.floor(viewport.height) }
  const canvas = newCanvas(size)
  await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' }).promise
  const pixels = canvas.getContext('2d')?.getImageData(0, 0, size.width, size.height).data
  const blank = pixels ? isBlankPicture(pixels) : false
  const blob = await canvasToBlob(canvas, 'image/png')
  canvas.width = 0
  canvas.height = 0
  return { blob, size, blank }
}

function layerInfo(config: Awaited<ReturnType<PdfDocument['getOptionalContentConfig']>> | null) {
  if (!config) return {}
  const layerNames = new Map<string, string>()
  for (const [id, group] of config) {
    const name = (group as { name?: unknown } | null)?.name
    if (typeof id === 'string' && typeof name === 'string') layerNames.set(id, name)
  }
  return { layerNames, isLayerVisible: (group: unknown) => config.isVisible(group) !== false }
}

/** Renders and reads one page of an open PDF. */
export async function preparePdfPage(pdf: OpenPdf, pageNumber: number, fileName: string): Promise<PreparedPlan> {
  const page = await pdf.doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  let { scale } = pageRenderScale(base.width, base.height)
  let rendered = await renderPage(pdf.pdfjs, page, scale)
  for (let i = 0; i < 4; i++) {
    const smaller = shrinkForBytes(rendered.size, rendered.blob.size, STORED_TARGET_BYTES)
    if (!smaller) break
    scale *= smaller.width / rendered.size.width
    rendered = await renderPage(pdf.pdfjs, page, scale)
  }
  if (rendered.blob.size > MAX_VENUE_IMAGE_BYTES) throw new PlanReadError('This page makes a picture too large to upload.')
  const config = await pdf.doc.getOptionalContentConfig().catch(() => null)
  const vectors = await readPdfPage(pdf.pdfjs, page, { scale, ...layerInfo(config) })
  const kind = classifyPage(vectors).kind
  if (kind === 'raster' && rendered.blank) {
    throw new PlanReadError('This page came out blank, so there is nothing to read. Check the page number, or save the plan as a PNG or JPG and import that.')
  }
  const diagonal = Math.hypot(vectors.width, vectors.height)
  return {
    blob: rendered.blob,
    width: rendered.size.width,
    height: rendered.size.height,
    kind,
    segments: kind === 'vector' ? extractWallSegments(vectors).segments : [],
    texts: vectors.texts.map((t) => ({ text: t.text, center: t.center })),
    doorHints: kind === 'vector' ? doorSwingHints(vectors.curves, diagonal * 0.004, diagonal * 0.08) : [],
    dimensionLabels: kind === 'vector' ? measureDimensionLines(vectors.texts, vectors.segments) : [],
    source: 'pdf',
    page: pageNumber,
    fileName,
  }
}

/** Redraws a PNG or JPG at the size the model reads, under about 3 MB. */
export async function prepareImage(file: File, type: 'png' | 'jpeg'): Promise<PreparedPlan> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new PlanReadError('This image could not be read. Try a PNG or JPG.')
  }
  try {
    let size = storedImageSize(bitmap.width, bitmap.height)
    let mime: 'image/png' | 'image/jpeg' = type === 'png' ? 'image/png' : 'image/jpeg'
    const draw = async () => {
      const canvas = newCanvas(size)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new PlanReadError('The browser could not make the picture.')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size.width, size.height)
      ctx.drawImage(bitmap, 0, 0, size.width, size.height)
      const blob = await canvasToBlob(canvas, mime, 0.9)
      canvas.width = 0
      canvas.height = 0
      return blob
    }
    let blob = await draw()
    if (blob.size > STORED_TARGET_BYTES && mime === 'image/png') {
      // A photo saved as PNG: JPEG keeps the size and fits.
      mime = 'image/jpeg'
      blob = await draw()
    }
    for (let i = 0; i < 4; i++) {
      const smaller = shrinkForBytes(size, blob.size, STORED_TARGET_BYTES)
      if (!smaller) break
      size = smaller
      blob = await draw()
    }
    if (blob.size > MAX_VENUE_IMAGE_BYTES) throw new PlanReadError('This image is too large to upload.')
    return {
      blob,
      width: size.width,
      height: size.height,
      kind: 'raster',
      segments: [],
      texts: [],
      doorHints: [],
      dimensionLabels: [],
      source: 'image',
      page: null,
      fileName: file.name,
    }
  } finally {
    bitmap.close()
  }
}
