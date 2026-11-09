import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DeleteDialogShell, TypedDeleteDialog } from './TypedDeleteDialog'

// The real dialog renders into a portal, which needs a browser. This one shows the props it got.
vi.mock('./Dialog', () => ({
  Dialog: (p: { open: boolean; title: string; children?: ReactNode; dismissable?: boolean }) =>
    p.open ? (
      <section data-title={p.title} data-dismissable={String(p.dismissable ?? true)}>
        {p.children}
      </section>
    ) : null,
  DialogActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const props = {
  onClose: () => undefined,
  title: 'Delete layout',
  loadMessage: () => new Promise<string>(() => {}),
  onConfirm: async () => undefined,
}

describe('TypedDeleteDialog', () => {
  it('renders nothing while closed', () => {
    expect(renderToStaticMarkup(<TypedDeleteDialog {...props} open={false} />)).toBe('')
  })

  it('can be dismissed with Esc or a tap outside while nothing is running', () => {
    const markup = renderToStaticMarkup(<TypedDeleteDialog {...props} open />)
    expect(markup).toContain('data-title="Delete layout"')
    expect(markup).toContain('data-dismissable="true"')
  })

  it('cannot be dismissed while the delete request runs, so a failure message is not lost', () => {
    const busy = renderToStaticMarkup(
      <DeleteDialogShell title="Delete layout" busy onClose={() => undefined}>
        <p>form</p>
      </DeleteDialogShell>,
    )
    expect(busy).toContain('data-dismissable="false"')
    const idle = renderToStaticMarkup(
      <DeleteDialogShell title="Delete layout" busy={false} onClose={() => undefined}>
        <p>form</p>
      </DeleteDialogShell>,
    )
    expect(idle).toContain('data-dismissable="true"')
  })
})
