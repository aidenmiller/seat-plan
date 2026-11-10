/**
 * The PNG floor plan for the import test (acceptance check 22), drawn when
 * the test runs so nothing binary is checked in. Made up, not a real venue:
 * a 1,000 by 700 px picture of one room with 10 px walls, a 90 px door gap
 * in the bottom wall with its leaf, a square column, and a dimension line
 * with end ticks above the room. fixtures/floorplan-draft.json is the reply
 * recorded for this picture, in the same pixels.
 *
 * 1,000 by 700 is small enough that the browser stores and sends it at its
 * own size (src/domain/floorplan/image-size.ts), so the recorded pixels still
 * match.
 */
import zlib from 'node:zlib'

export const PLAN_PNG = {
  width: 1000,
  height: 700,
  /** The walls' centre lines, in px: x from 100 to 900, y from 100 to 600. */
  room: { left: 100, top: 100, right: 900, bottom: 600 },
  wall: 10,
  door: { from: 450, to: 540 },
  column: { x: 700, y: 350, size: 20 },
  /** The dimension line over the room, 800 px long, labelled 40'-0". */
  dimension: { y: 60, from: 100, to: 900, text: `40'-0"`, valueCm: 1219.2 },
} as const

/** cm per px at the dimension label's scale: 40 ft over 800 px. */
export const PLAN_PNG_CM_PER_PX = PLAN_PNG.dimension.valueCm / (PLAN_PNG.dimension.to - PLAN_PNG.dimension.from)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** An 8-bit greyscale PNG; `shade(x, y)` gives each pixel (0 black, 255 white). */
export function encodeGreyPng(width: number, height: number, shade: (x: number, y: number) => number): Buffer {
  const row = width + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0
    for (let x = 0; x < width; x++) raw[y * row + 1 + x] = shade(x, y)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 0 // greyscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The plan described in PLAN_PNG. */
export function makePlanPng(): Buffer {
  const { room, wall, door, column, dimension } = PLAN_PNG
  const h = wall / 2
  const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1
  return encodeGreyPng(PLAN_PNG.width, PLAN_PNG.height, (x, y) => {
    const walls =
      inBox(x, y, room.left - h, room.top - h, room.right + h, room.top + h) ||
      inBox(x, y, room.right - h, room.top - h, room.right + h, room.bottom + h) ||
      inBox(x, y, room.left - h, room.top - h, room.left + h, room.bottom + h) ||
      inBox(x, y, room.left - h, room.bottom - h, door.from, room.bottom + h) ||
      inBox(x, y, door.to, room.bottom - h, room.right + h, room.bottom + h)
    if (walls) return 25
    // The door leaf, open into the room.
    if (inBox(x, y, door.from, room.bottom - (door.to - door.from), door.from + 2, room.bottom)) return 60
    if (inBox(x, y, column.x - column.size / 2, column.y - column.size / 2, column.x + column.size / 2, column.y + column.size / 2)) return 70
    // The dimension line and its ticks.
    if (inBox(x, y, dimension.from, dimension.y - 1, dimension.to, dimension.y + 1)) return 40
    if (inBox(x, y, dimension.from - 1, dimension.y - 10, dimension.from + 1, dimension.y + 10)) return 40
    if (inBox(x, y, dimension.to - 1, dimension.y - 10, dimension.to + 1, dimension.y + 10)) return 40
    return 255
  })
}
