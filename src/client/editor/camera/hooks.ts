/**
 * React reads of the camera: only the zoom percent text and the detail level
 * reach React (PLAN section 6). For a zoom label that never re-renders, use
 * ZoomPercentLabel, which the camera writes into directly.
 */
import { useSyncExternalStore } from 'react'
import type { DetailLevel } from '@/domain/detail-level'
import type { CameraController } from './camera-controller'

/** "75%". Re-renders while a zoom is under way; prefer ZoomPercentLabel for the corner label. */
export function useZoomText(camera: CameraController): string {
  return useSyncExternalStore(camera.subscribeZoomText, camera.zoomText, camera.zoomText)
}

/** Far, middle or close. Changes only when a pan or zoom settles. */
export function useDetailLevel(camera: CameraController): DetailLevel {
  return useSyncExternalStore(camera.subscribeDetailLevel, camera.detailLevel, camera.detailLevel)
}
