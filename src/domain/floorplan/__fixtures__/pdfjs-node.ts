/**
 * pdf.js for tests on Node. The legacy build is the one that runs on Node 22
 * (the modern build needs Promise.try). Importing the worker module first
 * sets globalThis.pdfjsWorker, so pdf.js runs its worker in this process
 * instead of loading a file next to pdf.mjs.
 */
import { pageRenderScale } from '../image-size'
import { readPdfPage, type PageVectors } from '../pdf-vectors'

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let loaded: Promise<Pdfjs> | null = null

export function loadPdfjs(): Promise<Pdfjs> {
  loaded ??= (async () => {
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
  return loaded
}

export type ReadPdf = PageVectors & { scale: number; operatorList: { fnArray: number[]; argsArray: unknown[] }; rotate: number }

/** Opens page 1 and reads it at the size the model reads without shrinking. */
export async function readFirstPage(data: Uint8Array): Promise<ReadPdf> {
  const pdfjs = await loadPdfjs()
  // pdf.js takes ownership of the buffer, so hand it a copy.
  const task = pdfjs.getDocument({ data: data.slice(), verbosity: pdfjs.VerbosityLevel.ERRORS })
  try {
    const pdf = await task.promise
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const { scale } = pageRenderScale(base.width, base.height)
    const vectors = await readPdfPage(pdfjs, page, { scale })
    const operatorList = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE })
    return { ...vectors, scale, operatorList, rotate: page.rotate }
  } finally {
    await task.destroy()
  }
}
