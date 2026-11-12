import { describe, expect, it } from 'vitest'
import manifest from './manifest'

describe('manifest', () => {
  it('names the app and uses the brand colors', () => {
    expect(manifest()).toMatchObject({
      name: 'Something Blueprint.',
      short_name: 'Blueprint.',
      start_url: '/',
      display: 'browser',
      background_color: '#fff9f0',
      theme_color: '#1e3a8a',
    })
  })

  it('lists the 192 and 512 px icons and the maskable one', () => {
    const icons = manifest().icons ?? []
    expect(icons.map((i) => [i.sizes, i.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ])
    expect(icons.map((i) => i.src)).toEqual([
      expect.stringMatching(/app-icon-192\.png/),
      expect.stringMatching(/app-icon-512\.png/),
      expect.stringMatching(/app-icon-maskable-512\.png/),
    ])
  })
})
