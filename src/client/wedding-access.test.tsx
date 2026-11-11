import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AdminViewBanner,
  useCanManageWedding,
  useWeddingAccess,
  WeddingAccessProvider,
  type WeddingAccessValue,
} from './wedding-access'
import { weddingAccessValue } from './wedding-access-value'

function Probe() {
  const { role, viaAdmin } = useWeddingAccess()
  return (
    <p>
      {role}/{String(viaAdmin)}/{String(useCanManageWedding())}
    </p>
  )
}

function within(access: WeddingAccessValue, children: ReactNode): string {
  return renderToStaticMarkup(<WeddingAccessProvider access={access}>{children}</WeddingAccessProvider>)
}

describe('weddingAccessValue', () => {
  it('uses a member role as it is', () => {
    expect(weddingAccessValue({ role: 'owner', viaAdmin: false, user: { isAdmin: false } })).toEqual({ role: 'owner', viaAdmin: false })
    expect(weddingAccessValue({ role: 'editor', viaAdmin: false, user: { isAdmin: false } })).toEqual({ role: 'editor', viaAdmin: false })
  })

  it('counts an admin who is not a member as an owner, in admin view', () => {
    expect(weddingAccessValue({ role: null, viaAdmin: true, user: { isAdmin: true } })).toEqual({ role: 'owner', viaAdmin: true })
  })

  it('counts an admin who is an editor as an owner, without the admin view', () => {
    expect(weddingAccessValue({ role: 'editor', viaAdmin: false, user: { isAdmin: true } })).toEqual({ role: 'owner', viaAdmin: false })
  })
})

describe('useWeddingAccess and useCanManageWedding', () => {
  it('hand down what the provider holds', () => {
    expect(within({ role: 'editor', viaAdmin: false }, <Probe />)).toContain('editor/false/false')
    expect(within({ role: 'owner', viaAdmin: false }, <Probe />)).toContain('owner/false/true')
    expect(within({ role: 'owner', viaAdmin: true }, <Probe />)).toContain('owner/true/true')
  })

  it('refuse to run outside the provider', () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrow('useWeddingAccess needs WeddingAccessProvider')
  })
})

describe('AdminViewBanner', () => {
  it('shows the notice in admin view', () => {
    const markup = within({ role: 'owner', viaAdmin: true }, <AdminViewBanner />)
    expect(markup).toContain('Admin view: you are not a member of this wedding. Changes are logged.')
    expect(markup).toContain('data-testid="admin-view-banner"')
  })

  it('is slim and takes no room from what is beside it', () => {
    const markup = within({ role: 'owner', viaAdmin: true }, <AdminViewBanner />)
    const classes = /class="([^"]*)"/.exec(markup)![1].split(' ')
    expect(classes).toEqual(expect.arrayContaining(['shrink-0', 'text-xs']))
    expect(classes.some((c) => /^(fixed|absolute|sticky|h-)/.test(c))).toBe(false)
  })

  it('shows nothing to a member', () => {
    expect(within({ role: 'owner', viaAdmin: false }, <AdminViewBanner />)).toBe('')
    expect(within({ role: 'editor', viaAdmin: false }, <AdminViewBanner />)).toBe('')
  })
})
