import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SignedOutShell } from './SignedOutShell'

/** The opening tags in some markup whose attributes include `needle`. */
function tagsWith(markup: string, needle: string): string[] {
  return [...markup.matchAll(/<[a-z0-9]+ [^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(needle))
}

describe('SignedOutShell', () => {
  it('puts the white lockup and a white card on blueprint paper', () => {
    const markup = renderToStaticMarkup(
      <SignedOutShell title="Sign in" intro="Guest lists and seating plans.">
        <form />
      </SignedOutShell>,
    )
    const [main] = tagsWith(markup, 'data-signed-out')
    expect(main).toMatch(/^<main /)
    expect(main).toContain('blueprint-paper')
    const [logo] = tagsWith(markup, 'data-logo')
    expect(logo).toContain('data-logo="horizontal-white"')
    expect(logo).toContain('alt="Something Blueprint."')
    expect(logo).toContain('width="320"')
    expect(markup).toContain('<h1 class="text-2xl font-semibold tracking-tight">Sign in</h1>')
    expect(markup).toContain('Guest lists and seating plans.</p><form>')
    expect(tagsWith(markup, 'bg-white')).toHaveLength(1)
  })

  it('leaves the heading to the content when given none, and takes a wider card and a test id', () => {
    const markup = renderToStaticMarkup(
      <SignedOutShell size="md" testId="some-page">
        <h1>Own heading</h1>
      </SignedOutShell>,
    )
    expect(markup.match(/<h1/g)).toHaveLength(1)
    expect(markup).not.toContain('<p')
    expect(tagsWith(markup, 'data-signed-out')[0]).toContain('data-testid="some-page"')
    expect(tagsWith(markup, 'bg-white')[0]).toContain('max-w-md')
  })

  it('says nothing but what the page gives it', () => {
    const markup = renderToStaticMarkup(
      <SignedOutShell>
        <form />
      </SignedOutShell>,
    )
    expect(markup.replace(/<[^>]+>/g, '')).toBe('')
  })
})
