/**
 * Acceptance check 9: shapes and text stay sharp at 800% (PLAN section 6,
 * "Units and camera"). During a zoom gesture the editor scales an HTML
 * wrapper around the world SVG; about 150 ms after the gesture stops it
 * writes the zoom into the SVG and takes the wrapper's transform off, so the
 * browser draws every shape and name again as vectors.
 *
 * After zooming to 800% (Ctrl+wheel, as a trackpad pinch sends it, on a
 * laptop; two fingers on a phone) and letting it settle, the test checks:
 *  - the wrapper scaled during the gesture and has no transform now, and the
 *    world SVG carries the 800% camera itself;
 *  - the world SVG holds no raster images;
 *  - a screenshot of the table name matches, pixel for pixel, the same SVG
 *    markup drawn directly at that scale in a fresh page.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { emptyCanvas, type Canvas } from '../src/domain/canvas-schema'
import { makeItem } from '../src/domain/presets'
import { isPhoneLayout, settledCamera, Touch, viewport, zoomLevel, type Point } from './canvas'
import { apiCreateLayout, apiCreateWedding, apiPutCanvas, editorPath, expectSaved, presetAuthor, signIn, uniqueName } from './helpers'

type Clip = { x: number; y: number; width: number; height: number }

/** Records every transform the camera writes on the wrapper around the world SVG. */
async function watchWrapper(page: Page): Promise<void> {
  await page.evaluate(() => {
    const wrapper = document.querySelector('[data-testid="canvas"]')!.parentElement!
    const seen: string[] = []
    ;(window as unknown as { __wrapperTransforms: string[] }).__wrapperTransforms = seen
    new MutationObserver(() => seen.push(wrapper.style.transform)).observe(wrapper, { attributes: true, attributeFilter: ['style'] })
  })
}

/** Compares two PNG screenshots of the same size in the browser: differing pixels and how much ink each holds. */
async function comparePngs(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([srcA, srcB]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = src
        })
      const pixels = (img: HTMLImageElement) => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data
      }
      const [ia, ib] = await Promise.all([load(srcA), load(srcB)])
      const pa = pixels(ia)
      const pb = pixels(ib)
      let differing = 0
      let inkA = 0
      let inkB = 0
      let edgeA = 0
      let edgeB = 0
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]))
        if (d > 24) differing++
        const la = (pa[i] + pa[i + 1] + pa[i + 2]) / 3
        const lb = (pb[i] + pb[i + 1] + pb[i + 2]) / 3
        if (la < 128) inkA++
        if (lb < 128) inkB++
        if (la > 48 && la < 208) edgeA++
        if (lb > 48 && lb < 208) edgeB++
      }
      return { width: ia.naturalWidth, height: ia.naturalHeight, sameSize: ia.naturalWidth === ib.naturalWidth && ia.naturalHeight === ib.naturalHeight, total: pa.length / 4, differing, inkA, inkB, edgeA, edgeB }
    },
    [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`] as const,
  )
}

test('shapes and text stay sharp at 800%', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Sharp', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  const id = randomUUID()
  const canvas: Canvas = { ...emptyCanvas(), items: [makeItem('round', { x: 0, y: 0 }, id, emptyCanvas())] }
  await apiPutCanvas(page.request, layout, canvas)

  await page.goto(editorPath(wedding.id, layout.id))
  await expectSaved(page)
  await settledCamera(page)
  const name = page.getByTestId('canvas').locator(`[data-item-id="${id}"] [data-table-name]`)
  await expect(name).toHaveText('Table 1')
  const box = await name.boundingBox()
  const at: Point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }

  await watchWrapper(page)
  if (await isPhoneLayout(page)) {
    // Two fingers spread 7.5 times apart about the name.
    await (await Touch.on(page)).pinch(at, 40, 300, { steps: 16 })
  } else {
    await page.mouse.move(at.x, at.y)
    await page.keyboard.down('Control')
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -60)
    await page.keyboard.up('Control')
  }
  await expect(zoomLevel(page)).toHaveText('800%')
  const camera = await settledCamera(page)
  expect(camera.zoom).toBe(8)

  // The wrapper moved during the gesture and has no transform now; the SVG holds the camera.
  const wrapperLog = await page.evaluate(() => (window as unknown as { __wrapperTransforms: string[] }).__wrapperTransforms)
  expect(wrapperLog.some((t) => t.startsWith('matrix(')), 'the wrapper scaled during the gesture').toBe(true)
  expect(wrapperLog.at(-1)).toBe('')
  const layers = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="canvas"]') as SVGSVGElement
    const wrapper = svg.parentElement as HTMLElement
    const style = getComputedStyle(wrapper)
    return {
      wrapperTransform: style.transform,
      wrapperWillChange: style.willChange,
      svgWillChange: getComputedStyle(svg).willChange,
      world: svg.querySelector(':scope > g')?.getAttribute('transform'),
      rasters: svg.querySelectorAll('image, foreignObject, canvas, img, video').length,
      viewportRasters: svg.closest('[data-editor-viewport]')!.querySelectorAll('canvas, img, video').length,
      backgrounds: [...svg.querySelectorAll('*')].filter((el) => getComputedStyle(el).backgroundImage !== 'none').length,
    }
  })
  expect(layers.wrapperTransform).toBe('none')
  expect(layers.wrapperWillChange).toBe('auto')
  expect(layers.svgWillChange).toBe('auto')
  expect(layers.world).toMatch(/^matrix\(8,0,0,8,/)
  expect(layers.rasters, 'raster images in the world SVG').toBe(0)
  expect(layers.viewportRasters, 'raster elements on the canvas').toBe(0)
  expect(layers.backgrounds, 'background images in the world SVG').toBe(0)

  // A piece of the name, as the editor shows it.
  await page.mouse.move(0, 0)
  const view = (await viewport(page).boundingBox())!
  const text = (await name.boundingBox())!
  const left = Math.max(text.x, view.x)
  const right = Math.min(text.x + text.width, view.x + view.width)
  const top = Math.max(text.y, view.y)
  const bottom = Math.min(text.y + text.height, view.y + view.height - 100)
  const width = Math.min(260, right - left)
  const height = Math.min(160, bottom - top)
  expect(width).toBeGreaterThan(60)
  expect(height).toBeGreaterThan(60)
  const clip: Clip = { x: Math.round((left + right - width) / 2), y: Math.round((top + bottom - height) / 2), width: Math.round(width), height: Math.round(height) }
  const shown = await page.screenshot({ clip, animations: 'disabled' })

  // The same SVG markup drawn directly at 800% in a fresh page, at the same place.
  const markup = await page.getByTestId('canvas').evaluate((svg) => svg.outerHTML)
  const reference = await context.newPage()
  try {
    await reference.setViewportSize(page.viewportSize()!)
    await reference.setContent(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#fff">` +
        `<div style="position:absolute;left:${view.x}px;top:${view.y}px;width:${view.width}px;height:${view.height}px;overflow:hidden">${markup}</div>` +
        `</body></html>`,
    )
    const direct = await reference.screenshot({ clip, animations: 'disabled' })
    const result = await comparePngs(reference, shown, direct)
    expect(result.sameSize).toBe(true)
    // There is text in the piece, in both.
    expect(result.inkA / result.total).toBeGreaterThan(0.05)
    expect(Math.abs(result.inkA - result.inkB) / result.total).toBeLessThan(0.005)
    // Soft (half-grey) edge pixels: a scaled-up bitmap would have far more than the vector drawing.
    expect(result.edgeA).toBeLessThanOrEqual(result.edgeB * 1.1 + result.total * 0.002)
    expect(result.differing / result.total, `${result.differing} of ${result.total} pixels differ`).toBeLessThan(0.002)
  } finally {
    await reference.close()
  }
})
