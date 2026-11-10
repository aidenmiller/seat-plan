'use client'

/**
 * The Properties tab (spec section 4; PLAN section 6, "Right panel"):
 *
 *  - one table: name, number, shape, size in the wedding's unit, rotation,
 *    seat count with − and +, seat sides, Fit seats, why it is outlined in
 *    yellow, Lock;
 *  - one fixture or shape: label or text, size, rotation, Lock;
 *  - one ceremony chair row: label, reserved for, chair count (with the
 *    same unseat question as tables), spacing, Select block, Add row
 *    behind, and its chairs in order;
 *  - one note: its text, color, Done, size or arrow ends, who added it and
 *    when (NoteProperties.tsx), Lock;
 *  - several items: align and distribute;
 *  - nothing: the Room panel (seats or chairs against the guest list) and
 *    the layout.
 *
 * A selected table lists its seats in order with each guest's name, in both
 * modes; in Edit mode a guest can be dragged to another seat in the list
 * (a mouse after 4 px, a finger after a 450 ms hold) or moved with the
 * Move up and Move down buttons, each one undo step (spec section 4,
 * "Seating guests"). Selected guests are named, with Unseat in Edit mode.
 *
 * In View mode it only shows: a tapped table lists its guests, read only.
 * The Snap and Keep proportions switches and the mouse wheel setting sit at
 * the bottom on every screen size (PLAN changes 11 and 14).
 *
 * It reads the selected items without x and y, compared field by field, so
 * dragging them re-renders nothing here (usePanelItems).
 */
import type { Canvas, Item, Seat } from '@/domain/canvas-schema'
import { chairTotals, MAX_CHAIRS_PER_ROW, rowName } from '@/domain/ceremony'
import { roomStats, roomStatsLines } from '@/domain/room-stats'
import { fitSeatCount, maxSeats, seatedCount, tightReason } from '@/domain/seats'
import type { WheelSetting } from '@/domain/wheel'
import { guestIdsAtSeats } from '../seating/guest-menu'
import { guestFullName } from '../seating/people'
import { GUEST_ROW_STYLE, useSeating } from '../seating/react'
import { setChairRow } from '../commands'
import { itemIndex, useCanvas, useEditorState, useMode, useUi, useViewState } from '../state/react'
import { shallowEqual } from '../state/store'
import { ButtonRow, CommitField, LengthField, NumberField, Section, Segmented, smallButton, smallDangerButton, Switch } from './controls'
import { useEditorUi } from './editor-ui'
import { ALIGN_BUTTONS, DISTRIBUTE_BUTTONS, FIXTURE_NAMES, itemName, SHAPE_NAMES, shapeIsLinear, shapeTakesText, type ItemFields } from './names'
import { NoteProperties, NoteSummary } from './NoteProperties'
import { canTakeShape, changeTableShape } from './table-shape'
import { useSeatReorder } from './seat-reorder'

type FieldsOf<K extends ItemFields['kind']> = Extract<ItemFields, { kind: K }>

/** An item as the panel shows it: a copy without x and y. */
export function panelFields(item: Item): ItemFields {
  const fields: Record<string, unknown> = { ...item }
  delete fields.x
  delete fields.y
  return fields as ItemFields
}

/** Same fields, one by one, in every item: x and y are not among them. */
export function samePanelItems(a: readonly ItemFields[], b: readonly ItemFields[]): boolean {
  return a.length === b.length && a.every((item, i) => shallowEqual(item, b[i]))
}

/** The selected items without x and y, in selection order: a drag that only moves them leaves this value alone. */
export function selectPanelItems(canvas: Canvas, selection: readonly string[]): ItemFields[] {
  const index = itemIndex(canvas)
  const out: ItemFields[] = []
  for (const id of selection) {
    const item = index.get(id)
    if (item) out.push(panelFields(item))
  }
  return out
}

function usePanelItems(): ItemFields[] {
  const selection = useUi((s) => s.selection)
  return useCanvas((canvas) => selectPanelItems(canvas, selection), samePanelItems)
}

const tableNumberCounts = new WeakMap<readonly Item[], Map<number, number>>()

/**
 * How many tables carry each number, worked out once per document version
 * and shared, so the "Another table also has number 3" check costs one
 * lookup however often it is read.
 */
export function tableNumberCount(items: readonly Item[], n: number): number {
  let counts = tableNumberCounts.get(items)
  if (!counts) {
    counts = new Map()
    for (const item of items) if (item.kind === 'table') counts.set(item.number, (counts.get(item.number) ?? 0) + 1)
    tableNumberCounts.set(items, counts)
  }
  return counts.get(n) ?? 0
}

export function PropertiesPanel() {
  const mode = useMode()
  const selected = usePanelItems()
  const guestSeats = useUi((s) => s.guestSeats)
  let body
  if (selected.length === 1) body = <SingleItem item={selected[0]} edit={mode === 'edit'} />
  else if (selected.length > 1) body = mode === 'edit' ? <SeveralItems items={selected} /> : <SeveralSummary items={selected} />
  else if (guestSeats.length > 0) body = <GuestSeatsSummary edit={mode === 'edit'} />
  else body = <RoomSummary />
  return (
    <div data-testid="properties-panel">
      {body}
      <EditorSettings />
    </div>
  )
}

function SingleItem({ item, edit }: { item: ItemFields; edit: boolean }) {
  switch (item.kind) {
    case 'table':
      return edit ? <TableProperties table={item} /> : <TableSeats table={item} />
    case 'fixture':
    case 'shape':
      return edit ? <ItemProperties item={item} /> : <ItemSummary item={item} />
    case 'chairRow':
      return edit ? <ChairRowProperties row={item} /> : <RowSeats row={item} />
    case 'note':
      return edit ? (
        <>
          <NoteProperties note={item} />
          <ItemOptions item={item} layering />
        </>
      ) : (
        <NoteSummary note={item} />
      )
  }
}

// ---------------------------------------------------------------- one table

const SHAPE_OPTIONS = [
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
  { value: 'rect', label: 'Rectangle' },
] as const

const SIDES_OPTIONS = [
  { value: 'all', label: 'All sides' },
  { value: 'noEnds', label: 'No ends' },
  { value: 'oneSide', label: 'One side' },
] as const

function TableProperties({ table }: { table: FieldsOf<'table'> }) {
  const { actions } = useEditorState()
  const { unit, onSeatRequest } = useEditorUi()
  const id = table.id
  const number = table.number
  const sharedNumber = useCanvas((c) => tableNumberCount(c.items, number) > 1)
  const locked = table.locked
  const reason = tightReason(table, unit)
  const fit = fitSeatCount(table)
  const max = maxSeats(table.shape)

  return (
    <>
      <Section title="Table" testId="table-properties">
        <CommitField label="Name" value={table.name} maxLength={100} testId="table-name" onCommit={(text) => void actions.renameTable(id, text)} />
        <NumberField label="Number" value={table.number} integer min={1} max={9999} testId="table-number" onChange={(n) => actions.setTableNumber(id, n)} />
        {sharedNumber && <p className="text-sm text-amber-700">Another table also has number {table.number}.</p>}
        <Segmented
          label="Shape"
          value={table.shape}
          options={SHAPE_OPTIONS.filter((o) => o.value === table.shape || table.seatCount <= maxSeats(o.value))}
          disabled={locked}
          testId="table-shape"
          onChange={(shape) => {
            if (canTakeShape(table, shape)) actions.run('Change shape', (c) => changeTableShape(c, id, shape))
          }}
        />
      </Section>

      <Section title="Size">
        {table.shape === 'round' ? (
          <LengthField label="Across" cm={table.width} unit={unit} disabled={locked} testId="table-across" onChange={(cm) => actions.setItemBox(id, { width: cm })} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Width" cm={table.width} unit={unit} disabled={locked} testId="table-width" onChange={(cm) => actions.setItemBox(id, { width: cm })} />
            <LengthField label="Depth" cm={table.height} unit={unit} disabled={locked} testId="table-depth" onChange={(cm) => actions.setItemBox(id, { height: cm })} />
          </div>
        )}
        <NumberField label="Rotation" value={table.rotation} suffix="°" disabled={locked} testId="table-rotation" onChange={(r) => actions.setItemBox(id, { rotation: r })} />
        {locked && <p className="text-xs text-stone-500">Unlock to move, turn or resize.</p>}
      </Section>

      <Section title="Seats">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <NumberField
              label="Seat count"
              value={table.seatCount}
              integer
              min={0}
              max={max}
              testId="table-seat-count"
              onChange={(n) => onSeatRequest(id, actions.setSeatCount(id, n))}
            />
          </div>
          <button
            type="button"
            className={`${smallButton} w-11 px-0 text-lg`}
            aria-label="One seat fewer"
            disabled={table.seatCount <= 0}
            onClick={() => onSeatRequest(id, actions.removeSeat(id))}
          >
            −
          </button>
          <button
            type="button"
            className={`${smallButton} w-11 px-0 text-lg`}
            aria-label="One more seat"
            disabled={table.seatCount >= max}
            onClick={() => onSeatRequest(id, actions.addSeat(id))}
          >
            +
          </button>
        </div>
        {table.shape !== 'round' && (
          <Segmented label="Seat sides" value={table.seatSides} options={SIDES_OPTIONS} testId="table-sides" onChange={(sides) => actions.setSeatSides(id, sides)} />
        )}
        <button
          type="button"
          className={`${smallButton} w-full`}
          disabled={fit === table.seatCount}
          onClick={() => onSeatRequest(id, actions.fitSeats(id))}
          data-testid="fit-seats"
        >
          {fit === table.seatCount ? 'Seats fit this size' : `Fit seats (${fit})`}
        </button>
        {reason && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900" data-testid="tight-reason">
            {reason}
          </p>
        )}
      </Section>

      <Section title="Guests" testId="table-guests-section">
        <SeatList id={table.id} seats={table.seats} edit />
      </Section>

      <ItemOptions item={table} />
    </>
  )
}

/** View mode: the table's guests in seat order, read only (spec section 4, "Seating guests"). */
function TableSeats({ table }: { table: FieldsOf<'table'> }) {
  const taken = seatedCount(table)
  return (
    <Section title={itemName(table)} testId="table-seats">
      <p className="text-sm text-stone-700">
        Table {table.number} · {taken} of {table.seatCount} seats taken
      </p>
      <SeatList id={table.id} seats={table.seats} edit={false} />
    </Section>
  )
}

// ---------------------------------------------------------------- one chair row

/** View mode: the row's guests in chair order, read only. */
function RowSeats({ row }: { row: FieldsOf<'chairRow'> }) {
  const taken = row.seats.filter((s) => s.guestId !== null).length
  return (
    <Section title={rowName(row)} testId="row-seats">
      <p className="text-sm text-stone-700">
        {row.blockLabel ? `${row.blockLabel} · ` : ''}
        {taken} of {row.chairCount} chairs taken
      </p>
      {row.reservedFor && <p className="text-sm text-amber-800">Reserved: {row.reservedFor}</p>}
      <SeatList id={row.id} seats={row.seats} edit={false} unit="Chair" />
    </Section>
  )
}

function ChairRowProperties({ row }: { row: FieldsOf<'chairRow'> }) {
  const { actions } = useEditorState()
  const { unit, onSeatRequest } = useEditorUi()
  const id = row.id
  const locked = row.locked
  const count = row.chairCount
  return (
    <>
      <Section title={rowName(row)} testId="row-properties">
        {row.blockLabel && <p className="text-sm text-stone-600">{row.blockLabel}</p>}
        <CommitField
          label="Row label"
          value={row.rowLabel}
          maxLength={100}
          hint={`Leave blank to show Row ${row.rowNumber}.`}
          testId="row-label"
          onCommit={(text) => void actions.run('Rename row', (c) => setChairRow(c, id, { rowLabel: text }))}
        />
        <CommitField
          label="Reserved for"
          value={row.reservedFor ?? ''}
          maxLength={200}
          hint="Such as Family, row 1. No names needed."
          testId="row-reserved"
          onCommit={(text) => void actions.run('Reserve row', (c) => setChairRow(c, id, { reservedFor: text }))}
        />
      </Section>

      <Section title="Chairs">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <NumberField
              label="Chair count"
              value={count}
              integer
              min={1}
              max={MAX_CHAIRS_PER_ROW}
              testId="row-chair-count"
              onChange={(n) => onSeatRequest(id, actions.setSeatCount(id, n))}
            />
          </div>
          <button
            type="button"
            className={`${smallButton} w-11 px-0 text-lg`}
            aria-label="One chair fewer"
            disabled={count <= 1}
            onClick={() => onSeatRequest(id, actions.setSeatCount(id, count - 1))}
          >
            −
          </button>
          <button
            type="button"
            className={`${smallButton} w-11 px-0 text-lg`}
            aria-label="One more chair"
            disabled={count >= MAX_CHAIRS_PER_ROW}
            onClick={() => onSeatRequest(id, actions.setSeatCount(id, count + 1))}
          >
            +
          </button>
        </div>
        <LengthField
          label="Spacing"
          cm={row.spacing}
          unit={unit}
          disabled={locked}
          testId="row-spacing"
          onChange={(cm) => void actions.run('Change spacing', (c) => setChairRow(c, id, { spacing: cm }))}
        />
        <p className="text-xs text-stone-500">From one chair&apos;s center to the next.</p>
        <NumberField label="Rotation" value={row.rotation} suffix="°" disabled={locked} testId="row-rotation" onChange={(r) => actions.setItemBox(id, { rotation: r })} />
        {locked && <p className="text-xs text-stone-500">Unlock to move or turn.</p>}
      </Section>

      <Section title="Block">
        <ButtonRow>
          {row.blockId && (
            <button type="button" className={smallButton} onClick={() => actions.selectBlock(id)} data-testid="select-block">
              Select block
            </button>
          )}
          <button type="button" className={smallButton} onClick={() => actions.addRowBehind(id)} data-testid="add-row-behind">
            Add row behind
          </button>
        </ButtonRow>
      </Section>

      <Section title="Guests" testId="row-guests-section">
        <SeatList id={id} seats={row.seats} edit unit="Chair" />
      </Section>

      <ItemOptions item={row} layering />
    </>
  )
}

/**
 * A table's seats or a row's chairs in order, each with its guest's name or
 * Empty. In Edit mode a guest row drags onto another row (swapping with
 * whoever sits there), and Move up and Move down do the same one seat at a
 * time.
 */
function SeatList({ id, seats, edit, unit = 'Seat' }: { id: string; seats: readonly Seat[]; edit: boolean; unit?: 'Seat' | 'Chair' }) {
  const { actions } = useEditorState()
  const people = useSeating((s) => s.people)
  const count = seats.length
  const { onPointerDown, drag } = useSeatReorder((from, to) => void actions.reorderSeat(id, from, to))
  if (count === 0) return <p className="text-sm text-stone-600">This table has no seats.</p>
  return (
    <ol className="space-y-1" data-testid="table-guests" aria-label={unit === 'Chair' ? 'Chairs in order' : 'Seats in order'}>
      {seats.map((seat, i) => {
        const guestId = seat.guestId
        const name = guestId ? guestFullName(people, guestId) : null
        const dragging = drag?.from === i
        const over = drag !== null && drag.over === i && drag.from !== i
        return (
          <li
            key={i}
            className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-stone-800 ${over ? 'bg-blue-50 ring-2 ring-blue-700' : dragging ? 'bg-stone-200' : 'bg-stone-50'} ${
              edit && guestId ? 'cursor-grab' : ''
            }`}
            style={edit && guestId ? GUEST_ROW_STYLE : undefined}
            onPointerDown={edit && guestId ? (event) => onPointerDown(event, i) : undefined}
            data-seat-row={i}
            data-seat-state={guestId ? 'taken' : 'empty'}
            data-guest-id={guestId ?? undefined}
            data-testid="table-guest"
          >
            <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${guestId ? 'bg-seat-taken' : 'bg-seat-empty'}`} />
            <span className="w-14 shrink-0 text-stone-500">
              {unit} {i + 1}
            </span>
            <span className={`min-w-0 flex-1 truncate ${name ? 'text-stone-900' : 'text-stone-500'}`}>{name ?? 'Empty'}</span>
            {edit && guestId && (
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className={`${smallButton} w-11 px-0`}
                  aria-label={`Move ${name} up a ${unit.toLowerCase()}`}
                  disabled={i === 0}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => actions.reorderSeat(id, i, i - 1)}
                  data-testid="seat-move-up"
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className={`${smallButton} w-11 px-0`}
                  aria-label={`Move ${name} down a ${unit.toLowerCase()}`}
                  disabled={i === count - 1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => actions.reorderSeat(id, i, i + 1)}
                  data-testid="seat-move-down"
                >
                  <span aria-hidden="true">↓</span>
                </button>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------- one fixture or shape

function ItemProperties({ item }: { item: FieldsOf<'fixture'> | FieldsOf<'shape'> }) {
  const { actions } = useEditorState()
  const { unit } = useEditorUi()
  const id = item.id
  const locked = item.locked
  const title = item.kind === 'fixture' ? FIXTURE_NAMES[item.type] : SHAPE_NAMES[item.type]
  const linear = item.kind === 'shape' && shapeIsLinear(item.type)

  return (
    <>
      <Section title={title} testId="item-properties">
        {item.kind === 'fixture' && (
          <CommitField
            label="Label"
            value={item.label}
            maxLength={200}
            hint={item.type === 'ceremonyStructure' ? 'Arch, chuppah, altar or anything else.' : undefined}
            testId="item-label"
            onCommit={(text) => void actions.setLabel(id, text)}
          />
        )}
        {item.kind === 'shape' && shapeTakesText(item.type) && (
          <CommitField
            label="Text"
            value={item.text ?? ''}
            maxLength={2000}
            multiline={item.type === 'text'}
            hint={item.type === 'text' ? 'Shift+Enter starts a new line.' : undefined}
            testId="item-label"
            onCommit={(text) => void actions.setLabel(id, text)}
          />
        )}
      </Section>
      <Section title="Size">
        {linear ? (
          <LengthField label="Length" cm={item.width} unit={unit} disabled={locked} testId="item-width" onChange={(cm) => actions.setItemBox(id, { width: cm })} />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Width" cm={item.width} unit={unit} disabled={locked} testId="item-width" onChange={(cm) => actions.setItemBox(id, { width: cm })} />
            <LengthField label="Depth" cm={item.height} unit={unit} disabled={locked} testId="item-depth" onChange={(cm) => actions.setItemBox(id, { height: cm })} />
          </div>
        )}
        <NumberField label="Rotation" value={item.rotation} suffix="°" disabled={locked} testId="item-rotation" onChange={(r) => actions.setItemBox(id, { rotation: r })} />
        {locked && <p className="text-xs text-stone-500">Unlock to move, turn or resize.</p>}
      </Section>
      <ItemOptions item={item} layering />
    </>
  )
}

function ItemOptions({ item, layering = false }: { item: ItemFields; layering?: boolean }) {
  const { actions } = useEditorState()
  return (
    <Section title="Options">
      <Switch
        label="Lock"
        hint="A locked item cannot move by accident."
        checked={item.locked}
        testId="lock-switch"
        onChange={(on) => actions.setLocked(on, [item.id])}
      />
      <ButtonRow>
        <button type="button" className={smallButton} onClick={() => actions.duplicateSelection()}>
          Duplicate
        </button>
        {layering && (
          <>
            <button type="button" className={smallButton} onClick={() => actions.bringToFront()}>
              To front
            </button>
            <button type="button" className={smallButton} onClick={() => actions.sendToBack()}>
              To back
            </button>
          </>
        )}
        <button type="button" className={smallDangerButton} disabled={item.locked} onClick={() => actions.deleteSelection()}>
          Delete
        </button>
      </ButtonRow>
    </Section>
  )
}

function ItemSummary({ item }: { item: ItemFields }) {
  const kind =
    item.kind === 'fixture' ? FIXTURE_NAMES[item.type] : item.kind === 'shape' ? SHAPE_NAMES[item.type] : item.kind === 'chairRow' ? 'Chair row' : 'Note'
  const name = itemName(item)
  return (
    <Section title={kind}>
      <p className="text-sm text-stone-800">{name}</p>
    </Section>
  )
}

// ---------------------------------------------------------------- several items

function SeveralItems({ items }: { items: ItemFields[] }) {
  const { actions } = useEditorState()
  const allLocked = items.every((i) => i.locked)
  const movable = items.filter((i) => !i.locked).length
  return (
    <>
      <Section title={`${items.length} items selected`} testId="multi-properties">
        <div>
          <p className="text-sm font-medium text-stone-700">Align</p>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {ALIGN_BUTTONS.map((b) => (
              <button key={b.mode} type="button" className={smallButton} disabled={movable === 0} onClick={() => actions.align(b.mode)}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-stone-700">Distribute</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {DISTRIBUTE_BUTTONS.map((b) => (
              <button key={b.axis} type="button" className={smallButton} disabled={items.length < 3} onClick={() => actions.distribute(b.axis)}>
                {b.label}
              </button>
            ))}
          </div>
          {items.length < 3 && <p className="mt-1 text-xs text-stone-500">Select 3 or more to space them evenly.</p>}
        </div>
      </Section>
      <Section title="Options">
        <Switch label="Lock all" checked={allLocked} testId="lock-switch" onChange={(on) => actions.setLocked(on)} />
        <ButtonRow>
          <button type="button" className={smallButton} onClick={() => actions.duplicateSelection()}>
            Duplicate
          </button>
          <button type="button" className={smallDangerButton} onClick={() => actions.deleteSelection()}>
            Delete
          </button>
        </ButtonRow>
      </Section>
    </>
  )
}

function SeveralSummary({ items }: { items: ItemFields[] }) {
  return (
    <Section title={`${items.length} items selected`}>
      <ul className="space-y-1 text-sm text-stone-800">
        {items.slice(0, 20).map((i) => (
          <li key={i.id}>{itemName(i)}</li>
        ))}
      </ul>
    </Section>
  )
}

/** Guests selected on the canvas: their names, and Unseat in Edit mode. */
function GuestSeatsSummary({ edit }: { edit: boolean }) {
  const { actions } = useEditorState()
  const seats = useUi((s) => s.guestSeats)
  const ids = useCanvas((c) => guestIdsAtSeats(c, seats), shallowEqual)
  const people = useSeating((s) => s.people)
  const count = ids.length
  return (
    <Section title={count === 1 ? '1 guest selected' : `${count} guests selected`} testId="selected-guests">
      <ul className="space-y-1 text-sm text-stone-900">
        {ids.slice(0, 50).map((id) => (
          <li key={id}>{guestFullName(people, id)}</li>
        ))}
      </ul>
      {edit && count > 0 && (
        <button type="button" className={`${smallButton} w-full`} onClick={() => actions.unseatSelectedGuests()} data-testid="unseat-selected">
          {count === 1 ? 'Unseat' : `Unseat ${count} guests`}
        </button>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------- nothing selected

function roomCounts(items: readonly Item[]): { tables: number; seats: number } {
  let tables = 0
  let seats = 0
  for (const item of items) {
    if (item.kind !== 'table') continue
    tables++
    seats += item.seatCount
  }
  return { tables, seats }
}

function RoomSummary() {
  const { layoutName, venueLabel, onPickVenue, layoutKind = 'reception', unit } = useEditorUi()
  const ceremony = layoutKind === 'ceremony'
  const { tables, seats } = useCanvas((c) => roomCounts(c.items), shallowEqual)
  const chairs = useCanvas((c) => chairTotals(c.items), shallowEqual)
  const items = useCanvas((c) => c.items)
  const guests = useSeating((s) => s.people.guests)
  const lines = guests.length > 0 ? roomStatsLines(roomStats({ layoutKind, canvas: { items }, guests }), unit) : []
  const tiles: [string, number][] = ceremony
    ? [
        ['Chairs', chairs.chairs],
        ['Reserved', chairs.reserved],
      ]
    : [
        ['Tables', tables],
        ['Seats', seats],
      ]

  return (
    <>
      <Section title="Room" testId="room-panel">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-stone-50 px-3 py-2">
              <dt className="text-stone-500">{label}</dt>
              <dd className="text-lg font-semibold text-stone-900">{value}</dd>
            </div>
          ))}
        </dl>
        {lines.length > 0 ? (
          <ul className="space-y-1 text-sm text-stone-800" data-testid="room-lines">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-600">{ceremony ? 'Chairs' : 'Seats'} against your guest list show here once guests are added.</p>
        )}
      </Section>
      <Section title="Layout">
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-stone-500">Name</dt>
            <dd className="break-words text-stone-900">{layoutName}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Venue</dt>
            <dd className="flex flex-wrap items-center justify-between gap-2 text-stone-900">
              <span className="min-w-0 break-words" data-testid="layout-venue">
                {venueLabel}
              </span>
              {onPickVenue && (
                <button type="button" className={smallButton} onClick={onPickVenue} data-testid="change-venue">
                  Change venue
                </button>
              )}
            </dd>
          </div>
        </dl>
      </Section>
    </>
  )
}

// ---------------------------------------------------------------- settings

const WHEEL_OPTIONS: readonly { value: WheelSetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'pan', label: 'Pan' },
]

function EditorSettings() {
  const { ui, view } = useEditorState()
  const { phone } = useEditorUi()
  const mode = useMode()
  const snap = useUi((s) => s.snap)
  const keep = useUi((s) => s.keepProportions)
  const wheel = useViewState((s) => s.wheel)
  return (
    <Section title="Settings" testId="editor-settings">
      {mode === 'edit' && (
        <>
          <Switch label="Snap" hint={phone ? 'To the grid, guides and 15° turns.' : 'Hold Alt to place freely.'} checked={snap} testId="snap-switch" onChange={(on) => ui.setSnap(on)} />
          <Switch
            label="Keep proportions"
            hint={phone ? 'When resizing with handles.' : 'Or hold Shift on a handle.'}
            checked={keep}
            testId="keep-proportions-switch"
            onChange={(on) => ui.setKeepProportions(on)}
          />
        </>
      )}
      <Segmented label="Mouse wheel" value={wheel} options={WHEEL_OPTIONS} testId="wheel-setting" onChange={(w) => view.setWheel(w)} />
      <p className="text-xs text-stone-500">Auto zooms with a mouse wheel and pans with a trackpad.</p>
    </Section>
  )
}
