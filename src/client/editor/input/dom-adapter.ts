/**
 * The thin layer between the browser and the editor controller. It turns DOM
 * events into the controller's inputs and does nothing else:
 *
 *  - pointer events on the viewport (captured, so a drag keeps going outside
 *    it), with handles found by their data attributes in the overlay:
 *    data-handle="nw" and so on, data-rotate-handle, and in the template
 *    editor data-vertex="<index>" for a wall's points. Anything inside
 *    [data-overlay-control] (the + and − seat buttons, menus) is left to its
 *    own handlers;
 *  - wheel, with { passive: false } so it can stop the page from scrolling
 *    or zooming (Chrome sends a trackpad pinch as a wheel event with Ctrl);
 *  - Safari's gesturestart / gesturechange / gestureend for a Mac trackpad
 *    pinch, only where GestureEvent exists and not on iPhone or iPad, whose
 *    pinches come as touch pointers;
 *  - contextmenu (right click) from a mouse; a touch's long press is the
 *    pointer machine's;
 *  - keydown and keyup on the window, skipped while a text field has focus
 *    or a dialog is open, with preventDefault on every key the editor
 *    handled;
 *  - window blur: cancel every press (their releases may never come), let go
 *    of Space and drop a drag.
 *
 * It also turns off what would fight the editor on the canvas: touch
 * scrolling and browser pinch zoom (touch-action: none), text selection and
 * the iPhone long-press callout.
 */
import type { CameraController } from '../camera/camera-controller'
import type { Handle } from '@/domain/resize'
import type { EditorController } from './controller'
import type { Target } from './hit-test'
import { isTextEntry } from './keyboard'
import type { PointerKind } from './pointer-machine'

const HANDLES = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])

/** What the adapter feeds: the layout editor's controller, or the venue template editor's. */
export type InputController = Pick<EditorController, 'pointer' | 'targetAt' | 'hover' | 'contextMenu' | 'wheel' | 'gesture' | 'keyDown' | 'keyUp' | 'blur'>

export type AttachInputOptions = {
  /** The element the canvas fills: the world wrapper and the overlay are inside it. */
  viewport: HTMLElement
  controller: InputController
  camera: CameraController
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' ? 'touch' : type === 'pen' ? 'pen' : 'mouse'
}

/** True on iPhone and iPad, iPadOS included (it reports itself as a Mac with touch). */
export function isIOS(nav: { userAgent?: string; platform?: string; maxTouchPoints?: number } = navigator): boolean {
  const ua = nav.userAgent ?? ''
  return /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
}

type ElementLike = Pick<Element, 'closest' | 'getAttribute'>
type RootLike = {
  contains(other: Node | null): boolean
  querySelectorAll?(selectors: string): ArrayLike<Pick<Element, 'getAttribute' | 'getBoundingClientRect'>>
}

function closestWithin(target: EventTarget | null, selector: string, root: RootLike): ElementLike | null {
  const el = target as Partial<ElementLike> | null
  if (!el || typeof el.closest !== 'function') return null
  const found = el.closest(selector)
  return found && root.contains(found) ? found : null
}

/**
 * The item's handle whose center is nearest a client point. On a small table
 * the 44 px touch targets of neighboring handles overlap (a 30 in deep table
 * is 19 px tall at 25%), and the one drawn last would otherwise take the
 * press: a touch on the end handle grabbed the corner and squashed the table.
 */
function nearestHandle(root: RootLike, itemId: string, x: number, y: number): string | null {
  if (typeof root.querySelectorAll !== 'function') return null
  let best: string | null = null
  let bestDistance = Infinity
  for (const el of Array.from(root.querySelectorAll('[data-handle]'))) {
    const name = el.getAttribute('data-handle') ?? ''
    if (el.getAttribute('data-item-id') !== itemId || !HANDLES.has(name)) continue
    const r = el.getBoundingClientRect()
    const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y)
    if (d < bestDistance) {
      best = name
      bestDistance = d
    }
  }
  return best
}

/**
 * A handle (the nearest of the item's handles under the pointer), the rotate
 * handle, or a point of a wall or outline (the template editor's
 * data-vertex="<index>") in the overlay, from their data attributes.
 */
export function overlayTarget(event: Pick<Event, 'target'> & { clientX?: number; clientY?: number }, root: RootLike): Target | null {
  const vertex = closestWithin(event.target, '[data-vertex]', root)
  if (vertex) {
    const index = Number(vertex.getAttribute('data-vertex'))
    const itemId = vertex.getAttribute('data-item-id') ?? ''
    if (Number.isInteger(index) && index >= 0 && itemId) return { kind: 'vertex', itemId, index }
  }
  const handle = closestWithin(event.target, '[data-handle]', root)
  if (handle) {
    const h = handle.getAttribute('data-handle') ?? ''
    const itemId = handle.getAttribute('data-item-id') ?? ''
    if (HANDLES.has(h) && itemId) {
      const nearest = typeof event.clientX === 'number' && typeof event.clientY === 'number' ? nearestHandle(root, itemId, event.clientX, event.clientY) : null
      return { kind: 'handle', itemId, handle: (nearest ?? h) as Handle }
    }
  }
  const rotate = closestWithin(event.target, '[data-rotate-handle]', root)
  if (rotate) {
    const itemId = rotate.getAttribute('data-item-id') ?? ''
    if (itemId) return { kind: 'rotate', itemId }
  }
  return null
}

function modalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null
}

type GestureLike = Event & { scale: number; clientX: number; clientY: number }

/** Starts listening. Returns a function that stops. */
export function attachInput({ viewport, controller, camera }: AttachInputOptions): () => void {
  const style = viewport.style
  const before = {
    touchAction: style.touchAction,
    userSelect: style.userSelect,
    callout: style.getPropertyValue('-webkit-touch-callout'),
    overscroll: style.overscrollBehavior,
  }
  style.touchAction = 'none'
  style.userSelect = 'none'
  style.setProperty('-webkit-user-select', 'none')
  style.setProperty('-webkit-touch-callout', 'none')
  style.overscrollBehavior = 'none'
  if (!viewport.hasAttribute('tabindex')) viewport.tabIndex = -1

  const pressed = new Set<number>()
  let lastTouchAt = -Infinity

  const screenOf = (e: { clientX: number; clientY: number }) => camera.clientToScreen(e.clientX, e.clientY)
  const ignored = (e: Event) => closestWithin(e.target, '[data-overlay-control]', viewport) !== null

  function onPointerDown(e: PointerEvent) {
    if (ignored(e)) return
    if (e.pointerType === 'touch') lastTouchAt = e.timeStamp
    camera.measure()
    // A click on the canvas takes focus from a text field, so shortcuts work again.
    const active = typeof document === 'undefined' ? null : document.activeElement
    if (active && active !== viewport && isTextEntry(active)) (active as HTMLElement).blur()
    if (e.pointerType === 'mouse') viewport.focus({ preventScroll: true })
    const at = screenOf(e)
    const target = overlayTarget(e, viewport) ?? controller.targetAt(at)
    try {
      viewport.setPointerCapture(e.pointerId)
    } catch {
      // The pointer may already be gone.
    }
    pressed.add(e.pointerId)
    controller.pointer({
      type: 'down',
      id: e.pointerId,
      pointer: pointerKind(e.pointerType),
      button: e.button,
      at,
      time: e.timeStamp,
      target,
      shift: e.shiftKey,
      alt: e.altKey,
    })
    if (e.pointerType !== 'mouse' || e.button === 1) e.preventDefault()
  }

  function onPointerMove(e: PointerEvent) {
    if (!pressed.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && e.buttons === 0 && !ignored(e)) controller.hover(screenOf(e))
      return
    }
    controller.pointer({ type: 'move', id: e.pointerId, at: screenOf(e), time: e.timeStamp, shift: e.shiftKey, alt: e.altKey })
  }

  function onPointerUp(e: PointerEvent) {
    if (!pressed.delete(e.pointerId)) return
    if (e.pointerType === 'touch') lastTouchAt = e.timeStamp
    controller.pointer({ type: 'up', id: e.pointerId, at: screenOf(e), time: e.timeStamp, shift: e.shiftKey, alt: e.altKey })
  }

  function onPointerCancel(e: PointerEvent) {
    if (!pressed.delete(e.pointerId)) return
    controller.pointer({ type: 'cancel', id: e.pointerId })
  }

  function onPointerLeave(e: PointerEvent) {
    if (e.pointerType === 'mouse' && !pressed.has(e.pointerId)) controller.hover(null)
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault()
    if (ignored(e)) return
    // Touch long presses are the pointer machine's; some browsers also send contextmenu for them.
    const kind = (e as PointerEvent).pointerType
    if (kind === 'touch' || e.timeStamp - lastTouchAt < 1000) return
    const at = screenOf(e)
    controller.contextMenu(at, overlayTarget(e, viewport) ?? controller.targetAt(at), 'mouse')
  }

  function onWheel(e: WheelEvent) {
    if (ignored(e)) return
    e.preventDefault()
    camera.measure()
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
    controller.wheel({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      wheelDeltaY: typeof legacy === 'number' ? legacy : undefined,
      timeStamp: e.timeStamp,
      at: screenOf(e),
    })
  }

  function onGesture(phase: 'start' | 'change' | 'end') {
    return (event: Event) => {
      const e = event as GestureLike
      e.preventDefault()
      controller.gesture(phase, e.scale, screenOf(e))
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented || isTextEntry(e.target) || modalOpen()) return
    if (controller.keyDown(e, e.target)) e.preventDefault()
  }

  function onKeyUp(e: KeyboardEvent) {
    if (controller.keyUp(e)) e.preventDefault()
  }

  function onBlur() {
    // A touch or press held while the window lost focus may never send its
    // pointerup here, which would leave the editor waiting for it.
    for (const id of [...pressed]) controller.pointer({ type: 'cancel', id })
    pressed.clear()
    controller.blur()
  }

  const gestureHandlers =
    typeof window !== 'undefined' && 'GestureEvent' in window && !isIOS()
      ? ([
          ['gesturestart', onGesture('start')],
          ['gesturechange', onGesture('change')],
          ['gestureend', onGesture('end')],
        ] as const)
      : []

  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('pointermove', onPointerMove)
  viewport.addEventListener('pointerup', onPointerUp)
  viewport.addEventListener('pointercancel', onPointerCancel)
  viewport.addEventListener('lostpointercapture', onPointerCancel)
  viewport.addEventListener('pointerleave', onPointerLeave)
  viewport.addEventListener('contextmenu', onContextMenu)
  viewport.addEventListener('wheel', onWheel, { passive: false })
  for (const [name, handler] of gestureHandlers) viewport.addEventListener(name, handler)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return () => {
    viewport.removeEventListener('pointerdown', onPointerDown)
    viewport.removeEventListener('pointermove', onPointerMove)
    viewport.removeEventListener('pointerup', onPointerUp)
    viewport.removeEventListener('pointercancel', onPointerCancel)
    viewport.removeEventListener('lostpointercapture', onPointerCancel)
    viewport.removeEventListener('pointerleave', onPointerLeave)
    viewport.removeEventListener('contextmenu', onContextMenu)
    viewport.removeEventListener('wheel', onWheel)
    for (const [name, handler] of gestureHandlers) viewport.removeEventListener(name, handler)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    style.touchAction = before.touchAction
    style.userSelect = before.userSelect
    style.setProperty('-webkit-touch-callout', before.callout)
    style.overscrollBehavior = before.overscroll
  }
}
