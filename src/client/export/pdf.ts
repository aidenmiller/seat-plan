/**
 * PDF files in the browser (PLAN section 3, "PDF out"): jsPDF, svg2pdf.js and
 * jspdf-autotable load only when someone exports, and every PDF embeds Noto
 * Sans Regular and Bold (public/fonts) so names with accents print. jsPDF
 * keeps only the letters a file uses.
 *
 * The floor plan comes from the print SVG (src/domain/export/print-svg.ts),
 * which svg2pdf.js draws as vectors and text. The lists are tables drawn by
 * jspdf-autotable on Letter portrait pages, with the title and date on top
 * and page numbers at the bottom.
 */
import type { MeasureText } from '@/domain/labels'
import { textWidthEm } from '@/domain/text-fit'

/** The name the PDFs know the font by; print-svg.ts asks for it first. */
export const PDF_FONT = 'NotoSans'
const FONT_FILES = { normal: '/fonts/NotoSans-Regular.ttf', bold: '/fonts/NotoSans-Bold.ttf' } as const

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let text = ''
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(text)
}

let fontData: Promise<{ normal: string; bold: string }> | null = null

/** The two font files as base64, fetched once per page. */
function loadFontData(): Promise<{ normal: string; bold: string }> {
  fontData ??= (async () => {
    const [normal, bold] = await Promise.all(
      [FONT_FILES.normal, FONT_FILES.bold].map(async (url) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error('Could not load the print font.')
        return toBase64(await res.arrayBuffer())
      }),
    )
    return { normal: normal!, bold: bold! }
  })().catch((err: unknown) => {
    fontData = null
    throw err
  })
  return fontData
}

let measurePromise: Promise<MeasureText> | null = null

/**
 * Text widths in the print font, from the browser's own text measuring once
 * the font file has loaded; a fair estimate if it cannot load.
 */
export function printMeasure(): Promise<MeasureText> {
  measurePromise ??= (async (): Promise<MeasureText> => {
    const estimate: MeasureText = (text, size) => textWidthEm(text) * size
    try {
      const face = new FontFace('SeatPlanPrint', `url(${FONT_FILES.normal})`)
      await face.load()
      document.fonts.add(face)
      const ctx = document.createElement('canvas').getContext('2d')
      if (!ctx) return estimate
      const base = 100
      ctx.font = `${base}px SeatPlanPrint`
      const cache = new Map<string, number>()
      return (text, size) => {
        let w = cache.get(text)
        if (w === undefined) {
          w = ctx.measureText(text).width / base
          if (cache.size > 5000) cache.clear()
          cache.set(text, w)
        }
        return w * size
      }
    } catch {
      return estimate
    }
  })()
  return measurePromise
}

async function newDocument(format: { width: number; height: number }, title: string) {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadFontData()])
  const doc = new jsPDF({ unit: 'pt', format: [format.width, format.height], orientation: format.width > format.height ? 'landscape' : 'portrait', compress: true })
  doc.addFileToVFS('NotoSans-Regular.ttf', fonts.normal)
  doc.addFont('NotoSans-Regular.ttf', PDF_FONT, 'normal')
  doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold)
  doc.addFont('NotoSans-Bold.ttf', PDF_FONT, 'bold')
  doc.setFont(PDF_FONT, 'normal')
  doc.setProperties({ title, creator: 'Something Blueprint.' })
  return doc
}

/** The print SVG as a one-page PDF of the same size. */
export async function floorPlanPdf(svg: string, page: { width: number; height: number }, title: string): Promise<Blob> {
  const [doc, { svg2pdf }] = await Promise.all([newDocument(page, title), import('svg2pdf.js')])
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = parsed.documentElement
  if (root.nodeName !== 'svg') throw new Error('Could not draw the plan.')
  // svg2pdf.js reads attributes from a live element, so the drawing joins the page, out of sight, while it works.
  const holder = document.createElement('div')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.position = 'fixed'
  holder.style.left = '-100000px'
  holder.style.top = '0'
  holder.style.width = '1px'
  holder.style.height = '1px'
  holder.style.overflow = 'hidden'
  const live = document.importNode(root, true)
  holder.appendChild(live)
  document.body.appendChild(holder)
  try {
    await svg2pdf(live, doc, { x: 0, y: 0, width: page.width, height: page.height })
  } finally {
    holder.remove()
  }
  return doc.output('blob')
}

/** Letter portrait, in points. */
const LIST_PAGE = { width: 612, height: 792 }
const LIST_MARGIN = 40

export type ListPdf = {
  title: string
  subtitle?: string
  date: string
  head: string[]
  body: string[][]
  /** Relative column widths; the last column takes what is left when omitted. */
  widths?: number[]
}

/** A list as a table, repeated headers on each page, page numbers at the bottom. */
export async function listPdf(list: ListPdf): Promise<Blob> {
  const [doc, { autoTable }] = await Promise.all([newDocument(LIST_PAGE, list.title), import('jspdf-autotable')])
  const inner = LIST_PAGE.width - 2 * LIST_MARGIN
  doc.setFont(PDF_FONT, 'bold')
  doc.setFontSize(16)
  doc.setTextColor('#1c1917')
  doc.text(list.title, LIST_MARGIN, LIST_MARGIN + 12)
  doc.setFont(PDF_FONT, 'normal')
  doc.setFontSize(10)
  doc.setTextColor('#57534e')
  doc.text(list.date, LIST_PAGE.width - LIST_MARGIN, LIST_MARGIN + 12, { align: 'right' })
  if (list.subtitle) doc.text(list.subtitle, LIST_MARGIN, LIST_MARGIN + 28)
  const total = list.widths?.reduce((a, b) => a + b, 0) ?? 0
  const columnStyles: Record<number, { cellWidth: number }> = {}
  list.widths?.forEach((w, i) => {
    columnStyles[i] = { cellWidth: (w / total) * inner }
  })
  autoTable(doc, {
    head: [list.head],
    body: list.body.length ? list.body : [[...list.head.map((_, i) => (i === 0 ? 'Nothing to list yet.' : ''))]],
    startY: LIST_MARGIN + 40,
    margin: { left: LIST_MARGIN, right: LIST_MARGIN, top: LIST_MARGIN, bottom: LIST_MARGIN + 10 },
    styles: { font: PDF_FONT, fontStyle: 'normal', fontSize: 10, cellPadding: 5, textColor: '#1c1917', lineColor: '#d6d3d1', lineWidth: 0.5, valign: 'top' },
    headStyles: { font: PDF_FONT, fontStyle: 'bold', fillColor: '#f5f5f4', textColor: '#1c1917' },
    columnStyles,
    rowPageBreak: 'avoid',
    didDrawPage: () => {
      doc.setFont(PDF_FONT, 'normal')
      doc.setFontSize(9)
      doc.setTextColor('#78716c')
      doc.text(`Page ${doc.getNumberOfPages()}`, LIST_PAGE.width - LIST_MARGIN, LIST_PAGE.height - LIST_MARGIN / 2, { align: 'right' })
    },
  })
  return doc.output('blob')
}
