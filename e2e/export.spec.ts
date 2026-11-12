/**
 * Acceptance check 20 (spec section 11; PLAN section 9): the exported floor
 * plan PDF prints with readable names at full-name detail. The PDF is read
 * back with pdf.js: every seated guest's full name is there once, at 6 pt or
 * larger, in an embedded font (Noto Sans, so accents print). The SVG has no
 * class attributes. The table list and escort card CSVs start with a byte
 * order mark, list tables by number and guests by last name, and guard cells
 * Excel would run as formulas.
 *
 * Laptops open the Export dialog from the editor's top bar; phones from the
 * layout's card on the Layouts tab (the phone's top bar has no room).
 */
import { readFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { emptyCanvas, type Canvas, type Table } from '../src/domain/canvas-schema'
import { generateSeatingBlock } from '../src/domain/ceremony'
import { makeItem } from '../src/domain/presets'
import type { Guest } from '../src/shared/api'
import { apiAddGuests, BOM, csvTextLines, expectHydrated } from './guest-list'
import { apiCreateLayout, apiCreateWedding, apiGetLayout, apiPutCanvas, editorPath, expectSaved, signIn, uniqueName } from './helpers'

type PdfText = { str: string; size: number; fontName: string }

/** Every text run on page 1, with its size in points, and whether each font it uses is embedded. */
async function readPdf(bytes: Buffer): Promise<{ items: PdfText[]; pages: number; embedded: Map<string, boolean>; width: number; height: number }> {
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: pdfjs.VerbosityLevel.ERRORS })
  try {
    const pdf = await task.promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    // Drawing the page loads its fonts, so their objects can be asked whether the file holds them.
    await page.getOperatorList()
    const content = await page.getTextContent()
    const items: PdfText[] = []
    const embedded = new Map<string, boolean>()
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue
      const [a, b] = item.transform as number[]
      items.push({ str: item.str, size: Math.hypot(a!, b!), fontName: item.fontName })
      if (!embedded.has(item.fontName)) {
        const font = page.commonObjs.get(item.fontName) as { missingFile?: boolean } | undefined
        embedded.set(item.fontName, font !== undefined && font.missingFile === false)
      }
    }
    return { items, pages: pdf.numPages, embedded, width: viewport.width, height: viewport.height }
  } finally {
    await task.destroy()
  }
}

/** Clicks `button` in the dialog and returns the file it hands the browser. */
async function downloadFrom(page: Page, button: Locator, testInfo: { outputPath(name: string): string }): Promise<{ bytes: Buffer; name: string }> {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), button.click()])
  const path = testInfo.outputPath(file.suggestedFilename())
  await file.saveAs(path)
  return { bytes: await readFile(path), name: file.suggestedFilename() }
}

function roundTable(canvas: Canvas, at: { x: number; y: number }, number: number, guests: (string | null)[]): Table {
  const t = makeItem('round', at, randomUUID(), canvas) as Table
  return { ...t, number, name: `Table ${number}`, seats: t.seats.map((s, i) => ({ ...s, guestId: guests[i] ?? null })) }
}

test('exports the floor plan as PDF and SVG, and the table list and escort cards as CSV', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  const phone = testInfo.project.name === 'phone'
  await signIn(page)
  const request = page.request
  const tag = randomBytes(2).toString('hex')
  const wedding = await apiCreateWedding(request, uniqueName('Export wedding', testInfo))
  const guests = await apiAddGuests(request, wedding.id, [
    { firstName: 'Zoë', lastName: `Kowalczyk${tag}`, meal: 'Fish' },
    { firstName: 'Łukasz', lastName: `Nowak${tag}`, meal: 'Vegan' },
    { firstName: 'Renée', lastName: `Dubois${tag}`, meal: 'Fish', notes: 'Private note for the couple' },
    { firstName: 'Ava', lastName: `Abbott${tag}` },
    { firstName: '=Cmd', lastName: `Young${tag}`, meal: '@Chef' },
    { firstName: 'Ben', lastName: `Unseated${tag}` },
  ])
  const by = (first: string): Guest => guests.find((g) => g.firstName === first)!
  // Table 2 is drawn first, so the lists must sort by number; the tables stand 9 m apart, so every name has room.
  let canvas = emptyCanvas()
  const t2 = roundTable(canvas, { x: 0, y: 0 }, 2, [by('Ava').id, by('=Cmd').id])
  canvas = { ...canvas, items: [t2] }
  const t1 = roundTable(canvas, { x: 900, y: 0 }, 1, [by('Zoë').id, by('Łukasz').id, null, by('Renée').id])
  canvas = { ...canvas, items: [t2, t1] }
  const t3 = roundTable(canvas, { x: 1800, y: 0 }, 3, [])
  canvas = { ...canvas, items: [t2, t1, t3] }
  const layoutName = `Reception ${tag}`
  const created = await apiCreateLayout(request, wedding.id, { name: layoutName })
  await apiPutCanvas(request, created, canvas)
  expect((await apiGetLayout(request, created.id)).canvas.items).toHaveLength(3)
  const seated = ['Zoë', 'Łukasz', 'Renée', 'Ava', '=Cmd'].map(by)

  // Open the Export dialog: the editor's top bar on a laptop, the layout's card on a phone.
  if (phone) {
    await page.goto(`/w/${wedding.id}/layouts`)
    const button = page.getByTestId('layout-card').filter({ hasText: layoutName }).getByTestId('layout-export')
    await expectHydrated(button)
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await button.click()
  } else {
    await page.goto(editorPath(wedding.id, created.id))
    await expectSaved(page)
    const button = page.getByTestId('export-button')
    await expectHydrated(button)
    await button.click()
  }
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await expect(dialog.getByTestId('export-form')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  // Full names on Tabloid, with notes, are the defaults.
  await expect(dialog.getByRole('radio', { name: 'Full names' })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('radio', { name: 'Tabloid' })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('switch', { name: 'Include notes' })).toHaveAttribute('aria-checked', 'true')
  // Nothing in the dialog is wider than the screen.
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }))
  expect(widths.page).toBeLessThanOrEqual(widths.screen)

  // The floor plan PDF: Tabloid landscape, every seated name once at 6 pt or more, in an embedded font.
  const pdf = await downloadFrom(page, dialog.getByRole('button', { name: 'Download floor plan' }), testInfo)
  expect(pdf.name).toBe(`${layoutName} floor plan.pdf`)
  expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(pdf.bytes.toString('latin1')).toContain('/FontFile2')
  if (!phone) {
    const read = await readPdf(pdf.bytes)
    expect(read.pages).toBe(1)
    expect(Math.round(read.width)).toBe(1224)
    expect(Math.round(read.height)).toBe(792)
    const all = read.items.map((i) => i.str).join('\n')
    for (const g of seated) {
      const name = `${g.firstName} ${g.lastName}`
      const runs = read.items.filter((i) => i.str.includes(name))
      expect(runs, `${name} once`).toHaveLength(1)
      expect(runs[0]!.size, `${name} size`).toBeGreaterThanOrEqual(6 - 0.01)
      expect(read.embedded.get(runs[0]!.fontName), `${name} font is embedded`).toBe(true)
    }
    expect(all).not.toContain(`Unseated${tag}`)
    expect(all).toContain(layoutName)
    expect(all).toContain('Table 1')
    // Every font the page uses is in the file.
    for (const [font, inFile] of read.embedded) expect(inFile, font).toBe(true)
  }

  // The SVG: plain attributes, no class.
  await dialog.getByRole('radio', { name: 'SVG' }).click()
  const svg = await downloadFrom(page, dialog.getByRole('button', { name: 'Download floor plan' }), testInfo)
  expect(svg.name).toBe(`${layoutName} floor plan.svg`)
  const svgText = svg.bytes.toString('utf8')
  expect(svgText.startsWith('<svg')).toBe(true)
  expect(svgText).not.toMatch(/\sclass=/)
  expect(svgText).not.toMatch(/\sstyle=/)
  expect(svgText).toContain(`>Łukasz Nowak${tag}</text>`)

  // The table list CSV: a byte order mark, tables by number, no guest notes.
  const tables = await downloadFrom(page, dialog.getByRole('button', { name: 'Table list CSV' }), testInfo)
  expect(tables.name).toBe(`${layoutName} table list.csv`)
  expect(tables.bytes.subarray(0, 3).equals(BOM)).toBe(true)
  const tableLines = csvTextLines(tables.bytes)
  expect(tableLines[0]).toBe('Table,Name,Seated,Seats,Meals,Guests')
  expect(tableLines.slice(1).map((l) => l.split(',')[0])).toEqual(['1', '2', '3'])
  expect(tableLines[1]).toBe(`1,Table 1,3,8,"Fish 2; Vegan 1","Zoë Kowalczyk${tag}; Łukasz Nowak${tag}; Renée Dubois${tag}"`)
  expect(tableLines[2]).toContain(`"'@Chef 1; No meal given 1"`)
  expect(tables.bytes.toString('utf8')).not.toContain('Private note')

  // The escort card CSV: a byte order mark, sorted by last name, formula cells guarded.
  const escort = await downloadFrom(page, dialog.getByRole('button', { name: 'Escort cards CSV' }), testInfo)
  expect(escort.name).toBe(`${layoutName} escort cards.csv`)
  expect(escort.bytes.subarray(0, 3).equals(BOM)).toBe(true)
  expect(csvTextLines(escort.bytes)).toEqual([
    'Last name,First name,Table,Table name',
    `Abbott${tag},Ava,2,Table 2`,
    `Dubois${tag},Renée,1,Table 1`,
    `Kowalczyk${tag},Zoë,1,Table 1`,
    `Nowak${tag},Łukasz,1,Table 1`,
    `Young${tag},'=Cmd,2,Table 2`,
  ])

  // The table list and escort card PDFs, in the embedded font.
  const tablePdf = await downloadFrom(page, dialog.getByRole('button', { name: 'Table list PDF' }), testInfo)
  expect(tablePdf.name).toBe(`${layoutName} table list.pdf`)
  const escortPdf = await downloadFrom(page, dialog.getByRole('button', { name: 'Escort cards PDF' }), testInfo)
  expect(escortPdf.name).toBe(`${layoutName} escort cards.pdf`)
  if (!phone) {
    const tableText = await readPdf(tablePdf.bytes)
    const text = tableText.items.map((i) => i.str).join('\n')
    expect(text).toContain(`Renée Dubois${tag}`)
    expect(text).toContain('Fish 2')
    expect(text).not.toContain('Private note')
    for (const [font, inFile] of tableText.embedded) expect(inFile, font).toBe(true)
    const escortText = (await readPdf(escortPdf.bytes)).items.map((i) => i.str)
    const order = [`Abbott${tag}`, `Dubois${tag}`, `Kowalczyk${tag}`, `Nowak${tag}`, `Young${tag}`].map((last) => escortText.findIndex((s) => s.includes(last)))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  }

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
})

test('exports a ceremony layout: escort cards give row and chair, and the ceremony list gives reserved rows and named seats', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone'
  await signIn(page)
  const request = page.request
  const tag = randomBytes(2).toString('hex')
  const wedding = await apiCreateWedding(request, uniqueName('Ceremony export', testInfo))
  const guests = await apiAddGuests(request, wedding.id, [
    { firstName: 'Mila', lastName: `Brandt${tag}` },
    { firstName: 'Omar', lastName: `Aziz${tag}` },
  ])
  const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 4, leftLabel: "Noa's side", rightLabel: "Aiden's side", origin: { x: 0, y: 0 } }, () => randomUUID())
  const items = rows.map((r) => {
    if (r.rowNumber === 1 && r.blockLabel === "Noa's side") return { ...r, reservedFor: 'Family, row 1' }
    if (r.rowNumber === 2 && r.blockLabel === "Aiden's side") return { ...r, seats: r.seats.map((s, i) => (i < 2 ? { ...s, guestId: guests[i]!.id } : s)) }
    return r
  })
  const layoutName = `Ceremony ${tag}`
  const created = await apiCreateLayout(request, wedding.id, { name: layoutName, kind: 'ceremony' })
  await apiPutCanvas(request, created, { ...emptyCanvas(), items })

  await page.goto(`/w/${wedding.id}/layouts`)
  const button = page.getByTestId('layout-card').filter({ hasText: layoutName }).getByTestId('layout-export')
  await expectHydrated(button)
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await expect(dialog.getByTestId('export-form')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  // A ceremony has no tables to list.
  await expect(dialog.getByRole('button', { name: 'Table list CSV' })).toHaveCount(0)

  const escort = await downloadFrom(page, dialog.getByRole('button', { name: 'Escort cards CSV' }), testInfo)
  expect(escort.bytes.subarray(0, 3).equals(BOM)).toBe(true)
  expect(csvTextLines(escort.bytes)).toEqual([
    'Last name,First name,Row,Chair',
    `Aziz${tag},Omar,"Aiden's side, Row 2",2`,
    `Brandt${tag},Mila,"Aiden's side, Row 2",1`,
  ])

  const list = await downloadFrom(page, dialog.getByRole('button', { name: 'Ceremony list PDF' }), testInfo)
  expect(list.name).toBe(`${layoutName} ceremony list.pdf`)
  if (!phone) {
    const text = (await readPdf(list.bytes)).items.map((i) => i.str).join('\n')
    expect(text).toContain('Family, row 1')
    expect(text).toContain(`Chair 1: Mila Brandt${tag}`)
    expect(text).toContain(`Chair 2: Omar Aziz${tag}`)
  }
})
