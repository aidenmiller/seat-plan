'use client'

/**
 * The template editor's Properties tab: the selected fixed item's fields.
 * A wall, room, zone or patio edge shows the length of the side picked on
 * the canvas (the one nearest the click), with buttons to step to the next
 * side; typing any length format (5′ 6″, 66 in, 1.7 m, 170 cm) moves that
 * side's far end along its line (spec: "Type exact lengths where we know
 * them"). Items the import marked unsure show the model's note and a button
 * to mark them checked.
 */
import { formatLength, parseLength, type LengthUnit } from '@/domain/units'
import { isClosedOutline, polylineSegmentLength, segmentCount } from '@/domain/fixed-items'
import {
  bringFixedToFront,
  deleteFixedItems,
  duplicateFixedItems,
  fixedItemLabel,
  isOpening,
  isPolyItem,
  markChecked,
  patchFixedItem,
  removeVertex,
  setSideLength,
  snapOpening,
  type TemplateDoc,
} from '@/domain/template-commands'
import type { FixedItem } from '@/domain/venue-schema'
import { ButtonRow, CommitField, LengthField, NumberField, Section, Segmented, smallButton, smallDangerButton } from '@/client/editor/panels/controls'
import { randomId } from '@/client/sync/random-id'
import { shallowEqual } from '@/client/editor/state/store'
import { useTemplateDoc, useTemplateEditor, useTemplateUi } from './react'

const SWINGS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'double', label: 'Double' },
  { value: 'none', label: 'None' },
] as const

const COLUMN_SHAPES = [
  { value: 'rect', label: 'Square' },
  { value: 'round', label: 'Round' },
] as const

const POINT_NAMES: Record<string, string> = { wall: 'wall', room: 'room', zone: 'zone', patioEdge: 'patio edge' }

export function TemplatePropertiesPanel({
  unit,
  canEdit,
  itemCount,
  onImport,
}: {
  unit: LengthUnit
  canEdit: boolean
  itemCount: number
  /** Opens the floor plan import; missing while a draft is open. */
  onImport?: () => void
}) {
  const editor = useTemplateEditor()
  const { selection, segment, mode } = useTemplateUi((s) => ({ selection: s.selection, segment: s.segment, mode: s.mode }), shallowEqual)
  const selected = useTemplateDoc(
    (d) => selection.map((id) => d.items.find((i) => i.id === id)).filter((i): i is FixedItem => i !== undefined),
    shallowEqual,
  )
  const disabled = !canEdit || mode !== 'edit'
  const run = (label: string, recipe: (d: TemplateDoc) => TemplateDoc, mergeKey?: string) => editor.actions.run(label, recipe, mergeKey)

  if (selected.length === 0) {
    return (
      <Section title="Venue" testId="template-properties">
        <p className="text-sm text-stone-700">{itemCount === 0 ? 'Nothing drawn yet.' : `${itemCount} ${itemCount === 1 ? 'item' : 'items'} on the plan.`}</p>
        {/* Not for someone who can only view the venue: they have no tools. */}
        {canEdit && <p className="text-sm text-stone-600">Pick a tool to draw walls, rooms, doors and the rest, or import a floor plan.</p>}
        {onImport && (
          <button type="button" className={smallButton} onClick={onImport} disabled={!canEdit} data-testid="import-plan-properties">
            Import a floor plan
          </button>
        )}
      </Section>
    )
  }

  if (selected.length > 1) {
    const ids = selected.map((i) => i.id)
    return (
      <Section title={`${selected.length} items`} testId="template-properties">
        <ButtonRow>
          <button type="button" className={smallButton} disabled={disabled} onClick={() => editor.actions.duplicateSelection()}>
            Duplicate
          </button>
          <button type="button" className={smallDangerButton} disabled={disabled} onClick={() => run('Delete', (d) => deleteFixedItems(d, ids))}>
            Delete
          </button>
        </ButtonRow>
      </Section>
    )
  }

  const item = selected[0]
  const patch = (label: string, fields: Record<string, unknown>) => run(label, (d) => patchFixedItem(d, item.id, fields))

  return (
    <div data-testid="template-properties">
      <Section title={fixedItemLabel(item)}>
        {item.unsure && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="unsure-note">
            <p className="font-medium">The import was not sure of this.</p>
            {item.unsureNote && <p className="mt-1">{item.unsureNote}</p>}
            <button type="button" className={`${smallButton} mt-2`} disabled={disabled} onClick={() => run('Mark checked', (d) => markChecked(d, item.id))}>
              Mark as checked
            </button>
          </div>
        )}
        {item.type !== 'label' && (
          <CommitField
            label="Name"
            value={item.name ?? ''}
            disabled={disabled}
            maxLength={200}
            hint={item.type === 'zone' ? 'Such as Patio or Main Room.' : undefined}
            testId="fixed-name"
            onCommit={(text) => {
              const name = text.trim()
              void patch('Rename', { name: name === '' ? undefined : name })
            }}
          />
        )}
      </Section>

      {isPolyItem(item) && <SidesSection item={item} sideIndex={segment?.itemId === item.id ? segment.index : 0} unit={unit} disabled={disabled} />}

      {item.type === 'wall' && (
        <Section title="Wall">
          <LengthField label="Thickness" cm={item.thickness} unit={unit} disabled={disabled} onChange={(cm) => patch('Change thickness', { thickness: cm })} testId="wall-thickness" />
        </Section>
      )}

      {isOpening(item) && (
        <Section title={item.type === 'door' ? 'Door' : 'Window'}>
          <LengthField label="Width" cm={item.width} unit={unit} disabled={disabled} onChange={(cm) => patch('Change width', { width: cm })} testId="opening-width" />
          {item.type === 'door' && (
            <Segmented label="Opens" value={item.swing} options={SWINGS} disabled={disabled} onChange={(swing) => patch('Change door', { swing })} />
          )}
          <p className="text-sm text-stone-700">{item.wallId ? 'On a wall.' : 'Not on a wall.'}</p>
          <ButtonRow>
            <button
              type="button"
              className={smallButton}
              disabled={disabled}
              onClick={() =>
                run('Snap to wall', (d) => {
                  const current = d.items.find((i) => i.id === item.id)
                  if (!current || !isOpening(current)) return d
                  const next = snapOpening(current, d.items)
                  return next === current ? d : { ...d, items: d.items.map((i) => (i.id === item.id ? next : i)) }
                })
              }
            >
              Snap to nearest wall
            </button>
            {item.type === 'door' && (
              <button type="button" className={smallButton} disabled={disabled} onClick={() => patch('Flip door', { rotation: (item.rotation + 180) % 360 })}>
                Flip side
              </button>
            )}
          </ButtonRow>
        </Section>
      )}

      {(item.type === 'column' || item.type === 'stairs' || item.type === 'bar') && (
        <Section title="Size">
          {item.type === 'column' && (
            <Segmented
              label="Shape"
              value={item.shape}
              options={COLUMN_SHAPES}
              disabled={disabled}
              onChange={(shape) => patch('Change column', shape === 'round' ? { shape, height: item.width } : { shape })}
            />
          )}
          {item.type === 'column' && item.shape === 'round' ? (
            <LengthField label="Across" cm={item.width} unit={unit} disabled={disabled} onChange={(cm) => patch('Change size', { width: cm, height: cm })} />
          ) : (
            <>
              <LengthField label="Width" cm={item.width} unit={unit} disabled={disabled} onChange={(cm) => patch('Change size', { width: cm })} testId="box-width" />
              <LengthField label="Depth" cm={item.height} unit={unit} disabled={disabled} onChange={(cm) => patch('Change size', { height: cm })} testId="box-depth" />
            </>
          )}
          {item.type === 'bar' && (
            <CommitField label="Text on it" value={item.label} disabled={disabled} maxLength={200} onCommit={(text) => void patch('Change label', { label: text.trim() })} />
          )}
          <NumberField label="Rotation" value={item.rotation} suffix="°" disabled={disabled} onChange={(rotation) => patch('Rotate', { rotation: ((rotation % 360) + 360) % 360 })} />
        </Section>
      )}

      {item.type === 'label' && (
        <Section title="Text">
          <CommitField
            label="Text"
            value={item.text}
            disabled={disabled}
            multiline
            maxLength={500}
            testId="label-text"
            onCommit={(text) => (text.trim() === '' ? 'Type some text.' : void patch('Change text', { text: text.trim() }))}
          />
          <LengthField label="Text height" cm={item.fontSize} unit={unit} disabled={disabled} onChange={(cm) => patch('Change text size', { fontSize: cm })} />
          <NumberField label="Rotation" value={item.rotation} suffix="°" disabled={disabled} onChange={(rotation) => patch('Rotate', { rotation: ((rotation % 360) + 360) % 360 })} />
        </Section>
      )}

      {isOpening(item) && (
        <Section title="Turn">
          <NumberField label="Rotation" value={item.rotation} suffix="°" disabled={disabled} onChange={(rotation) => patch('Rotate', { rotation: ((rotation % 360) + 360) % 360 })} />
        </Section>
      )}

      <Section title="Item">
        <ButtonRow>
          <button
            type="button"
            className={smallButton}
            disabled={disabled}
            onClick={() => {
              let added: string[] = []
              const ok = run('Duplicate', (d) => {
                const r = duplicateFixedItems(d, [item.id], randomId, 30.48, 30.48)
                added = r.ids
                return r.doc
              })
              if (ok) editor.ui.select(added)
            }}
          >
            Duplicate
          </button>
          <button type="button" className={smallButton} disabled={disabled} onClick={() => run('Bring to front', (d) => bringFixedToFront(d, [item.id]))}>
            Bring to front
          </button>
          <button type="button" className={smallDangerButton} disabled={disabled} onClick={() => run('Delete', (d) => deleteFixedItems(d, [item.id]))} data-testid="delete-fixed">
            Delete
          </button>
        </ButtonRow>
      </Section>
    </div>
  )
}

function SidesSection({
  item,
  sideIndex,
  unit,
  disabled,
}: {
  item: Extract<FixedItem, { type: 'wall' | 'room' | 'zone' | 'patioEdge' }>
  sideIndex: number
  unit: LengthUnit
  disabled: boolean
}) {
  const editor = useTemplateEditor()
  const closed = isClosedOutline(item)
  const count = segmentCount(item.points, closed)
  const index = Math.min(Math.max(0, sideIndex), Math.max(0, count - 1))
  const length = polylineSegmentLength(item.points, index, closed)
  const go = (next: number) => editor.ui.setSegment({ itemId: item.id, index: (next + count) % count })
  const minPointsLeft = item.type === 'room' || item.type === 'zone' ? 3 : 2
  return (
    <section className="border-b border-stone-200 px-4 py-4" data-testid="side-length-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Side {index + 1} of {count}
        </h3>
        <div className="flex gap-1">
          <button type="button" className={smallButton} aria-label="Previous side" onClick={() => go(index - 1)} disabled={count < 2}>
            ‹
          </button>
          <button type="button" className={smallButton} aria-label="Next side" onClick={() => go(index + 1)} disabled={count < 2}>
            ›
          </button>
        </div>
      </div>
      <div className="mt-3 space-y-3">
        <CommitField
          label="Length"
          value={formatLength(length, unit)}
          disabled={disabled || length === 0}
          hint="Moves the far end of this side along its line. Any unit works: 12′ 6″, 150 in, 3.8 m, 380 cm."
          testId="side-length"
          onCommit={(text) => {
            const cm = parseLength(text, unit)
            if (cm === null || !(cm > 0)) return unit === 'ft' ? 'Type a length, such as 12′ 6″ or 150 in.' : 'Type a length, such as 3.8 m or 380 cm.'
            editor.actions.run('Set length', (d) => setSideLength(d, item.id, index, cm))
          }}
        />
        <p className="text-xs text-stone-500">
          {item.points.length} points on this {POINT_NAMES[item.type]}. Drag a point to move it.
        </p>
        {item.points.length > minPointsLeft && (
          <button
            type="button"
            className={smallButton}
            disabled={disabled}
            onClick={() => editor.actions.run('Remove point', (d) => removeVertex(d, item.id, (index + 1) % item.points.length))}
          >
            Remove the far point
          </button>
        )}
      </div>
    </section>
  )
}
