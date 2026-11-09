'use client'

/**
 * The zoom level and the zoom out, zoom in, 100% and fit buttons, in the
 * bottom right corner on every screen size (PLAN section 6, "Keyboard"). The
 * camera writes the percent straight into its label, so zooming re-renders
 * nothing here.
 */
import { ZoomPercentLabel } from '../camera/ZoomPercentLabel'
import { Icon } from '../icons/glyphs'
import { useEditorState } from '../state/react'

/** The controls' height: 44 px buttons, 2 px padding and a 1 px border above and below. The overlay keeps its buttons clear of it. */
export const ZOOM_CONTROLS_PX = 50

const button =
  'inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-stone-800 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50'

export function ZoomControls({ className = '' }: { className?: string }) {
  const { actions, camera } = useEditorState()
  return (
    <div
      role="group"
      aria-label="Zoom"
      data-testid="zoom-controls"
      className={`flex items-center rounded-xl border border-stone-200 bg-white/95 p-0.5 shadow-md backdrop-blur ${className}`}
    >
      <button type="button" className={button} aria-label="Zoom out" title="Zoom out" aria-keyshortcuts="Control+- Meta+-" onClick={() => actions.zoomOut()}>
        <Icon name="minus" />
      </button>
      <ZoomPercentLabel camera={camera} className="w-12 text-center text-sm tabular-nums text-stone-700" />
      <button type="button" className={button} aria-label="Zoom in" title="Zoom in" aria-keyshortcuts="Control+= Meta+=" onClick={() => actions.zoomIn()}>
        <Icon name="plus" />
      </button>
      <button type="button" className={button} aria-label="Zoom to 100%" title="Zoom to 100%" aria-keyshortcuts="Control+0 Meta+0" onClick={() => actions.zoomReset()}>
        100%
      </button>
      <button type="button" className={button} aria-label="Fit to content" title="Fit to content" aria-keyshortcuts="Control+1 Meta+1" onClick={() => actions.zoomFit()}>
        <Icon name="fit" />
      </button>
    </div>
  )
}
