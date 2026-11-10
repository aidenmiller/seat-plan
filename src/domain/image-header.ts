/**
 * Reads what an uploaded floor plan image is from its first bytes (PLAN
 * change 6: PNG or JPEG only). The type comes from the file's own signature,
 * never from a header the browser sent, and the size from the PNG IHDR chunk
 * or the JPEG start-of-frame segment. Nothing here decodes pixels.
 */

export type ImageHeader = { contentType: 'image/png' | 'image/jpeg'; width: number; height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function u16(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!
}

function u32(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!
}

function readPng(b: Uint8Array): ImageHeader | null {
  // Signature, then the IHDR chunk: length (13), "IHDR", width, height.
  if (b.length < 24) return null
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null
  const width = u32(b, 16)
  const height = u32(b, 20)
  if (width === 0 || height === 0) return null
  return { contentType: 'image/png', width, height }
}

/** Start-of-frame markers: they carry the size. C4 (DHT), C8 (JPG) and CC (DAC) are not frames. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function readJpeg(b: Uint8Array): ImageHeader | null {
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return null
    // Any number of 0xFF fill bytes may come before a marker.
    while (i < b.length && b[i] === 0xff) i++
    if (i >= b.length) return null
    const marker = b[i]!
    i++
    // Markers without a length: TEM and the restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    // End of image or start of scan before any frame: no size to read.
    if (marker === 0xd9 || marker === 0xda || marker === 0xd8) return null
    if (i + 2 > b.length) return null
    const length = u16(b, i)
    if (length < 2) return null
    if (isStartOfFrame(marker)) {
      // Length, precision, height, width.
      if (length < 7 || i + 7 > b.length) return null
      const height = u16(b, i + 3)
      const width = u16(b, i + 5)
      if (width === 0 || height === 0) return null
      return { contentType: 'image/jpeg', width, height }
    }
    i += length
  }
  return null
}

/** The image's type and size, or null when it is not a PNG or JPEG this can read. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, k) => bytes[k] === v)) return readPng(bytes)
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return readJpeg(bytes)
  return null
}
