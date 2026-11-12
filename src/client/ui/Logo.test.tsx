import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { assetUrl } from '@/brand/brand'
import horizontalWhiteFile from '@/brand/logo-horizontal-white.svg'
import horizontalFile from '@/brand/logo-horizontal.svg'
import markFile from '@/brand/logo-mark.svg'
import { Logo, LOGO_MIN_WIDTH } from './Logo'

function unescapeHtml(text: string): string {
  return text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** The attributes of each <img> in some markup. */
function images(markup: string): Record<string, string>[] {
  return [...markup.matchAll(/<img ([^>]*)\/?>/g)].map((m) =>
    Object.fromEntries([...(m[1] ?? '').matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((a) => [a[1], unescapeHtml(a[2] ?? '')])),
  )
}

describe('Logo', () => {
  it('names the product, with its final period, unless it is decorative', () => {
    const [named] = images(renderToStaticMarkup(<Logo variant="mark" width={40} />))
    expect(named?.alt).toBe('Something Blueprint.')
    const [decorative] = images(renderToStaticMarkup(<Logo variant="mark" width={40} decorative />))
    expect(decorative?.alt).toBe('')
  })

  it('draws the brand files at their own proportions', () => {
    const [mark] = images(renderToStaticMarkup(<Logo variant="mark" width={40} />))
    expect(mark).toMatchObject({ width: '40', height: '40', 'data-logo': 'mark' })
    expect(mark?.src).toBe(assetUrl(markFile))
    const [horizontal] = images(renderToStaticMarkup(<Logo variant="horizontal" width={328} />))
    // The lockup's viewBox is 1640 by 280.
    expect(horizontal).toMatchObject({ width: '328', height: '56', 'data-logo': 'horizontal' })
    expect(horizontal?.src).toBe(assetUrl(horizontalFile))
  })

  it('has the lockup in white for navy, the same shape as the full-color one', () => {
    const [white] = images(renderToStaticMarkup(<Logo variant="horizontal-white" width={328} />))
    expect(white).toMatchObject({ alt: 'Something Blueprint.', width: '328', height: '56', 'data-logo': 'horizontal-white' })
    expect(white?.src).toBe(assetUrl(horizontalWhiteFile))
    expect(white?.src).not.toBe(assetUrl(horizontalFile))
  })

  it('never goes below the brand minimums: 320 px for the lockups, 24 px for the mark', () => {
    expect(LOGO_MIN_WIDTH).toEqual({ mark: 24, horizontal: 320, 'horizontal-white': 320 })
    expect(images(renderToStaticMarkup(<Logo variant="horizontal" width={200} />))[0]?.width).toBe('320')
    expect(images(renderToStaticMarkup(<Logo variant="horizontal-white" width={200} />))[0]?.width).toBe('320')
    expect(images(renderToStaticMarkup(<Logo variant="mark" width={16} />))[0]?.width).toBe('24')
  })
})
