import { describe, expect, it } from 'vitest'
import { makeGridPng } from './floorplan/__fixtures__/plans'
import { readImageHeader } from './image-header'

/** A JPEG header: SOI, an APP0 segment, a DQT-like segment, then a frame header of the given kind. */
function jpeg(width: number, height: number, sof = 0xc0, fill = false): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
  const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]
  const frame = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return new Uint8Array([0xff, 0xd8, ...app0, ...(fill ? [0xff, 0xff] : []), ...dqt, ...frame, 0xff, 0xd9])
}

describe('readImageHeader', () => {
  it('reads a PNG', () => {
    expect(readImageHeader(makeGridPng(37, 21))).toEqual({ contentType: 'image/png', width: 37, height: 21 })
  })

  it('reads a JPEG from its frame header, baseline or progressive, after fill bytes', () => {
    expect(readImageHeader(jpeg(2576, 1449))).toEqual({ contentType: 'image/jpeg', width: 2576, height: 1449 })
    expect(readImageHeader(jpeg(800, 600, 0xc2))).toEqual({ contentType: 'image/jpeg', width: 800, height: 600 })
    expect(readImageHeader(jpeg(10, 20, 0xc0, true))).toEqual({ contentType: 'image/jpeg', width: 10, height: 20 })
  })

  it('skips segments that look like frames but are not (DHT)', () => {
    const b = jpeg(640, 480)
    // A DHT segment (C4) before the frame must not be read as the size.
    const dht = [0xff, 0xc4, 0x00, 0x07, 0x00, 0x09, 0x09, 0x09, 0x09]
    const withDht = new Uint8Array([...b.slice(0, 2), ...dht, ...b.slice(2)])
    expect(readImageHeader(withDht)).toEqual({ contentType: 'image/jpeg', width: 640, height: 480 })
  })

  it('refuses other files, cut-off headers and zero sizes', () => {
    expect(readImageHeader(new Uint8Array([]))).toBeNull()
    expect(readImageHeader(new TextEncoder().encode('GIF89a......'))).toBeNull()
    expect(readImageHeader(new TextEncoder().encode('%PDF-1.7\n'))).toBeNull()
    expect(readImageHeader(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(readImageHeader(makeGridPng(4, 4).slice(0, 20))).toBeNull()
    expect(readImageHeader(jpeg(0, 10))).toBeNull()
    expect(readImageHeader(jpeg(300, 200).slice(0, 30))).toBeNull()
    // Start of scan before any frame.
    expect(readImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull()
    // A PNG signature without its IHDR chunk.
    const png = makeGridPng(4, 4)
    png[12] = 0x58
    expect(readImageHeader(png)).toBeNull()
  })
})
