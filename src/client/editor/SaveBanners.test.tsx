import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NotStoredBanner, SaveFailedBanner, SaveStatusSlot, type SaveFailedBannerProps } from './SaveBanners'
import { NOT_STORED_MESSAGE } from './save-status'

const html = (node: React.ReactElement) => renderToStaticMarkup(node)

describe('SaveStatusSlot', () => {
  it('keeps a fixed width whatever the status says, with the whole text in the title', () => {
    const texts = [
      html(<SaveStatusSlot status={{ kind: 'saved', at: 'x' }} />),
      html(<SaveStatusSlot status={{ kind: 'saving' }} />),
      html(
        <SaveStatusSlot
          status={{ kind: 'retrying', attempt: 1, nextTryAt: 'x', reason: 'No answer from the server.', storedLocally: true }}
        />,
      ),
    ]
    for (const markup of texts) {
      const className = /class="([^"]*)"/.exec(markup)![1].split(' ')
      expect(className).toEqual(expect.arrayContaining(['w-24', 'shrink-0', 'truncate']))
      expect(className.some((c) => c.startsWith('max-w-'))).toBe(false)
    }
    expect(texts[2]).toContain('title="Not saved, retrying. No answer from the server."')
    expect(texts[2]).toContain('>Not saved, retrying</p>')
    expect(texts[0]).toContain('data-status="saved"')
  })
})

describe('NotStoredBanner', () => {
  it('shows the sentence, or nothing', () => {
    expect(html(<NotStoredBanner message={null} />)).toBe('')
    expect(html(<NotStoredBanner message={NOT_STORED_MESSAGE} />)).toContain(
      'Not saved on this device. Keep this page open until it says Saved.',
    )
  })
})

describe('SaveFailedBanner', () => {
  const base: SaveFailedBannerProps = {
    status: null,
    gone: false,
    storedLocally: true,
    loginHref: '/login?next=%2Fw%2F1',
    copying: false,
    copyError: null,
    onSaveCopy: () => undefined,
    onDownload: () => undefined,
  }

  it('is not there while saving works', () => {
    expect(html(<SaveFailedBanner {...base} status={{ kind: 'saved', at: 'x' }} />)).toBe('')
  })

  it.each([
    ['gone', { status: { kind: 'failed', reason: 'gone', message: 'This layout was deleted, so changes cannot be saved.' } }],
    ['invalid', { status: { kind: 'failed', reason: 'invalid', message: 'The server could not save this layout.' } }],
    ['deleted outside a save', { gone: true }],
  ] as const)('offers Save as a copy first, then Download a copy (%s)', (_name, over) => {
    const markup = html(<SaveFailedBanner {...base} {...over} />)
    const saveAt = markup.indexOf('Save as a copy')
    const downloadAt = markup.indexOf('Download a copy')
    expect(saveAt).toBeGreaterThan(-1)
    expect(downloadAt).toBeGreaterThan(saveAt)
    expect(markup).not.toContain('Sign in again')
  })

  it('says the copy is under way, and shows why it failed', () => {
    const busy = html(<SaveFailedBanner {...base} gone copying />)
    expect(busy).toContain('Saving a copy…')
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>Saving a copy…/)
    const failed = html(<SaveFailedBanner {...base} gone copyError="Could not make the copy. Try again." />)
    expect(failed).toContain('Could not make the copy. Try again.')
  })

  it('asks a signed-out tab to sign in again, without claiming a copy it does not have', () => {
    const status = {
      kind: 'failed',
      reason: 'signed-out',
      message: 'You were signed out. Sign in again to keep saving. Your changes are kept on this device.',
    } as const
    const kept = html(<SaveFailedBanner {...base} status={status} />)
    expect(kept).toContain('Sign in again</a>')
    expect(kept).toContain('Your changes are kept on this device.')
    expect(kept).not.toContain('Save as a copy')
    const notKept = html(<SaveFailedBanner {...base} status={status} storedLocally={false} />)
    expect(notKept).not.toContain('kept on this device')
  })
})
