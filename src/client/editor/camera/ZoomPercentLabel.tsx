'use client'

/**
 * The zoom level in the bottom right corner ("75%"). The camera writes the
 * text straight into the element on each frame, so zooming re-renders no
 * React component (PLAN section 6, "Speed target").
 */
import { useEffect, useRef } from 'react'
import type { CameraController } from './camera-controller'

export function ZoomPercentLabel({ camera, className }: { camera: CameraController; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return camera.bindZoomLabel(el)
  }, [camera])
  return (
    <span ref={ref} className={className} data-testid="zoom-level">
      {camera.zoomText()}
    </span>
  )
}
