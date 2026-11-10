/**
 * The template editor's state for one open venue template, built once per
 * page like the layout editor's (src/client/editor/state/index.ts) and from
 * the same parts: the generic document store and guard (doc-store.ts,
 * editor-doc.ts), the camera, the per-device view store (camera and the
 * reference image's show switch, under "venue:<id>"), the remembered Edit or
 * View mode, the pointer machine and the DOM adapter.
 *
 *   const [store] = useState(() => createDocStore<TemplateDoc>(doc))
 *   const [editor] = useState(() => createTemplateEditor({ templateId, store, onCommit, unit: () => unit }))
 *   useEffect(() => editor.mount({ viewport, wrapper, world }), [editor])
 */
import { randomId } from '@/client/sync/random-id'
import { createCameraController, type CameraController, type CameraTargets, type FrameScheduler } from '@/client/editor/camera/camera-controller'
import type { DocStore } from '@/client/editor/doc-store'
import { attachInput } from '@/client/editor/input/dom-adapter'
import { browserStorage, createViewStore, writeMode, type StorageLike, type ViewStore } from '@/client/editor/state/device-view'
import { createEditorDoc, type EditorDoc } from '@/client/editor/state/editor-doc'
import { initialMode, readDeviceTraits, type DeviceTraits } from '@/client/editor/state/mode'
import type { EditorMode } from '@/client/editor/state/ui-store'
import type { TemplateDoc } from '@/domain/template-commands'
import type { LengthUnit } from '@/domain/units'
import { createTemplateController, type TemplateActions, type TemplateController, type TemplateEvents } from './controller'
import { createTemplateInteractionStore, createTemplateUiStore, type TemplateInteractionStore, type TemplateUiStore } from './ui-store'

/** The per-device view key: the camera and the reference image switch of one template. */
export function templateViewKey(templateId: string): string {
  return `venue:${templateId}`
}

export type TemplateEditorOptions = {
  templateId: string
  store: DocStore<TemplateDoc>
  /** The page's own gate (author picked, saving ready, no conflict). Default: always. */
  canEdit?: () => boolean
  /** A finished change: hand it to the save engine, or keep it in the import draft. */
  onCommit: (doc: TemplateDoc) => void
  /** Feet or meters on this device: the grid and every length. */
  unit: () => LengthUnit
  /** The reference image's size in pixels (the template's, or the import draft's), for fit to content. */
  imageSize?: () => { width: number; height: number } | null
  events?: TemplateEvents
  storage?: StorageLike | null
  newId?: () => string
  scheduler?: FrameScheduler
  traits?: () => DeviceTraits
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
}

export type TemplateMountTargets = { viewport: HTMLElement; wrapper: HTMLElement; world: SVGGElement }

export type TemplateEditor = {
  templateId: string
  store: DocStore<TemplateDoc>
  doc: EditorDoc<TemplateDoc>
  ui: TemplateUiStore
  interaction: TemplateInteractionStore
  view: ViewStore
  camera: CameraController
  controller: TemplateController
  actions: TemplateActions
  loadDevice(): void
  mount(targets: TemplateMountTargets): () => void
  setUnit(unit: LengthUnit): void
  destroy(): void
}

export function createTemplateEditor(options: TemplateEditorOptions): TemplateEditor {
  const storage = options.storage !== undefined ? options.storage : browserStorage()
  const { store } = options
  const ui = createTemplateUiStore()
  const interaction = createTemplateInteractionStore()
  const view = createViewStore(templateViewKey(options.templateId), storage)
  const camera = createCameraController({ scheduler: options.scheduler, gridUnit: options.unit(), onSettle: (c) => view.saveCamera(c) })
  const doc = createEditorDoc<TemplateDoc>({
    store,
    canEdit: () => ui.getState().mode === 'edit' && (options.canEdit?.() ?? true),
    onCommit: options.onCommit,
  })

  function setMode(mode: EditorMode) {
    if (mode === 'view') doc.cancelGesture()
    ui.setMode(mode)
    writeMode(storage, mode)
  }

  const controller = createTemplateController({
    doc,
    ui,
    interaction,
    view,
    camera,
    unit: options.unit,
    newId: options.newId ?? randomId,
    setMode,
    imageSize: options.imageSize,
    events: options.events,
    now: options.now,
    setTimer: options.setTimer,
  })

  const unsubscribe = store.subscribe(() => {
    if (!doc.gesture()) ui.prune(store.getState().canvas)
  })

  let loaded = false
  let savedCamera = false

  function loadDevice() {
    if (loaded) return
    loaded = true
    const traits = (options.traits ?? readDeviceTraits)()
    const saved = view.load()
    savedCamera = saved !== null
    if (saved) camera.set(saved, { immediate: true })
    ui.setState({ mode: initialMode(storage, traits), deviceKnown: true })
  }

  return {
    templateId: options.templateId,
    store,
    doc,
    ui,
    interaction,
    view,
    camera,
    controller,
    actions: controller.actions,
    loadDevice,
    mount(targets) {
      loadDevice()
      const detachCamera = camera.attach(targets as unknown as CameraTargets)
      if (!savedCamera) {
        controller.actions.zoomFit()
        savedCamera = true
      }
      const detachInput = attachInput({ viewport: targets.viewport, controller, camera })
      return () => {
        detachInput()
        detachCamera()
      }
    },
    setUnit: (unit) => camera.setGridUnit(unit),
    destroy() {
      unsubscribe()
      controller.destroy()
      camera.flush()
      camera.destroy()
    },
  }
}
