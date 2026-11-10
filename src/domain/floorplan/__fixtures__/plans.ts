/**
 * Test floor plans, made with pdf-lib when a test runs (nothing binary is
 * checked in). Also usable to write files for the end-to-end tests:
 *
 *   fs.writeFileSync('room.pdf', await makeRoomPdf())
 *
 * The room plan (made up, not a real venue): a 10 m by 8 m room at 1:50 on a
 * Letter landscape page. Its walls are one thick stroke (20 cm) drawn in
 * meters under a scaling transform, with a 0.9 m door gap in the bottom wall,
 * a door leaf and a curved swing, 12 short hatching lines, a dimension line
 * with end ticks and the text "10.00 m" above the room, a "MAIN ROOM" label,
 * a filled 0.4 m column, and a 1.764 m partition wall drawn inside a form
 * XObject squeezed to half its width.
 */
import zlib from 'node:zlib'
import {
  appendBezierCurve,
  concatTransformationMatrix,
  degrees,
  fill,
  lineTo,
  moveTo,
  PDFDocument,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingRgbColor,
  setLineWidth,
  setStrokingRgbColor,
  StandardFonts,
  stroke,
} from 'pdf-lib'

/** PDF points per real meter at 1:50 (1 m is 2 cm on paper). */
export const PT_PER_M = (72 / 2.54) * 2
/** Where the plan's (0, 0) sits on the page, in points. */
export const ORIGIN_PT = { x: 80, y: 70 }
export const PAGE_PT = { width: 792, height: 612 }

/** What the room plan holds, in meters, for the tests to check against. */
export const ROOM = {
  width: 10,
  depth: 8,
  wall: 0.2,
  doorFrom: 4.0,
  doorTo: 4.9,
  /** Bottom wall pieces either side of the door, then right, top, left, and the partition. */
  wallLengths: [4.0, 5.1, 8, 10, 8, 1.7638888],
  partition: { x: 7, y: 2.5, length: (200 * 0.5) / PT_PER_M },
  column: { x: 6, y: 4, size: 0.4 },
  dimension: { text: '10.00 m', valueCm: 1000 },
} as const

export type RoomOptions = {
  /** The page's /Rotate. */
  rotate?: 0 | 90 | 180 | 270
  /** Set a crop box 20 pt inside the media box on every side. */
  crop?: boolean
  /** Walls as filled rectangles (solid poché) instead of a thick stroke. */
  solidWalls?: boolean
  /** Walls as two thin face lines 20 cm apart, everything drawn with one pen. */
  doubleLineWalls?: boolean
}

export async function makeRoomPdf(options: RoomOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_PT.width, PAGE_PT.height])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const M = PT_PER_M
  const { x: ox, y: oy } = ORIGIN_PT
  const W = ROOM.width
  const H = ROOM.depth
  const d0 = ROOM.doorFrom
  const d1 = ROOM.doorTo
  const t = ROOM.wall
  const thin = options.doubleLineWalls ? 0.5 / M : 0.02

  const ops = [pushGraphicsState(), concatTransformationMatrix(M, 0, 0, M, ox, oy), setStrokingRgbColor(0, 0, 0)]
  if (options.solidWalls) {
    // Each wall a filled rectangle centred on its centre line.
    const h = t / 2
    ops.push(
      setFillingRgbColor(0, 0, 0),
      rectangle(d1, -h, W - d1, t),
      rectangle(W - h, 0, t, H),
      rectangle(0, H - h, W, t),
      rectangle(-h, 0, t, H),
      rectangle(0, -h, d0, t),
      fill(),
    )
  } else if (options.doubleLineWalls) {
    const h = t / 2
    ops.push(
      setLineWidth(thin),
      // Outer face, from one door jamb round to the other.
      moveTo(d1, -h),
      lineTo(W + h, -h),
      lineTo(W + h, H + h),
      lineTo(-h, H + h),
      lineTo(-h, -h),
      lineTo(d0, -h),
      // Inner face.
      moveTo(d1, h),
      lineTo(W - h, h),
      lineTo(W - h, H - h),
      lineTo(h, H - h),
      lineTo(h, h),
      lineTo(d0, h),
      // Jambs closing the wall ends at the door.
      moveTo(d0, -h),
      lineTo(d0, h),
      moveTo(d1, -h),
      lineTo(d1, h),
      stroke(),
    )
  } else {
    ops.push(setLineWidth(t), moveTo(d1, 0), lineTo(W, 0), lineTo(W, H), lineTo(0, H), lineTo(0, 0), lineTo(d0, 0), stroke())
  }
  ops.push(
    // Door leaf and its swing, hinged at the left jamb.
    setLineWidth(thin),
    moveTo(d0, 0),
    lineTo(d0, 0.9),
    stroke(),
    moveTo(d0, 0.9),
    appendBezierCurve(d0 + 0.497, 0.9, d1, 0.497, d1, 0),
    stroke(),
    // Hatching in the top left corner.
    setLineWidth(options.doubleLineWalls ? thin : 0.01),
    ...Array.from({ length: 12 }, (_, i) => [moveTo(0.2 + i * 0.1, H - 0.6), lineTo(0.5 + i * 0.1, H - 0.3)]).flat(),
    stroke(),
    // A filled column.
    setFillingRgbColor(0.3, 0.3, 0.3),
    rectangle(ROOM.column.x, ROOM.column.y, ROOM.column.size, ROOM.column.size),
    fill(),
    popGraphicsState(),
  )
  page.pushOperators(...ops)

  // Dimension line above the room, in plain page points.
  const dimY = oy + H * M + 18
  const dimWidth = options.doubleLineWalls ? 0.5 : 0.3
  page.drawLine({ start: { x: ox, y: dimY }, end: { x: ox + W * M, y: dimY }, thickness: dimWidth, color: rgb(0, 0, 0) })
  page.drawLine({ start: { x: ox, y: dimY - 4 }, end: { x: ox, y: dimY + 4 }, thickness: dimWidth })
  page.drawLine({ start: { x: ox + W * M, y: dimY - 4 }, end: { x: ox + W * M, y: dimY + 4 }, thickness: dimWidth })
  page.drawText(ROOM.dimension.text, { x: ox + (W * M) / 2 - 15, y: dimY + 3, size: 8, font })
  page.drawText('MAIN ROOM', { x: ox + 3.5 * M, y: oy + 5 * M, size: 14, font })

  // The partition, inside a form XObject placed at half width.
  const partDoc = await PDFDocument.create()
  const pp = partDoc.addPage([200, 20])
  pp.pushOperators(setStrokingRgbColor(0, 0, 0), setLineWidth(options.doubleLineWalls ? 1 : 6), moveTo(0, 10), lineTo(200, 10), stroke())
  const [embedded] = await doc.embedPdf(await partDoc.save())
  page.drawPage(embedded, { x: ox + ROOM.partition.x * M, y: oy + ROOM.partition.y * M - 10, xScale: 0.5, yScale: 1 })

  if (options.crop) page.setCropBox(20, 20, PAGE_PT.width - 40, PAGE_PT.height - 40)
  if (options.rotate) page.setRotation(degrees(options.rotate))
  return doc.save()
}

/** A PNG of a grid, like a scanned plan. */
export function makeGridPng(width: number, height: number): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const v = x % 50 < 3 || y % 50 < 3 ? 20 : 235
      raw.fill(v, y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3)
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/** A page that is one picture and nothing else, like a scanned plan. */
export async function makeScanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_PT.width, PAGE_PT.height])
  const img = await doc.embedPng(makeGridPng(1100, 850))
  page.drawImage(img, { x: 0, y: 0, width: PAGE_PT.width, height: PAGE_PT.height })
  return doc.save()
}

/**
 * A "scan" whose picture is CCITT fax (Group 4) encoded, the way most
 * scanners and copiers store black and white pages. Every row is one
 * vertical-mode code, so the 64 by 64 picture decodes to a solid block that
 * covers the page and renders black. pdf.js decodes it only with its
 * WebAssembly decoder (wasmUrl); without it the page renders white.
 */
export async function makeCcittScanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([PAGE_PT.width, PAGE_PT.height])
  const side = 64
  const image = doc.context.stream(new Uint8Array(side / 8).fill(0xff), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: side,
    Height: side,
    ColorSpace: 'DeviceGray',
    BitsPerComponent: 1,
    Filter: 'CCITTFaxDecode',
    DecodeParms: doc.context.obj({ K: -1, Columns: side, Rows: side }),
    Decode: [1, 0],
  })
  page.node.setXObject(PDFName.of('Scan'), doc.context.register(image))
  const content = doc.context.stream(new TextEncoder().encode(`q ${PAGE_PT.width} 0 0 ${PAGE_PT.height} 0 0 cm /Scan Do Q`))
  page.node.set(PDFName.of('Contents'), doc.context.register(content))
  return doc.save({ useObjectStreams: false })
}
