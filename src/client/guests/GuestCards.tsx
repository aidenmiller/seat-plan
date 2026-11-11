'use client'

/**
 * The guest list on phones: one card per guest with the same actions as the
 * table. Edit opens every field of the guest in a dialog, each saving on
 * its own as in the table; the check box selects the guest for Add to group.
 */
import { memo, type ReactNode } from 'react'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { secondaryButton } from '@/client/ui/styles'
import { fullName } from '@/domain/guest-list'
import { sideLabel } from '@/domain/partners'
import type { Group, Guest, GuestRsvp, GuestSide } from '@/shared/api'
import { CheckField, EditableText, GroupChip, SelectField } from './cells'
import { DeleteButton } from './GuestTable'
import { RSVP_LABEL, RSVP_OPTIONS } from './options'
import { usePartnerNames, useSideOptions } from './partners-context'
import type { GuestRowActions } from './row-actions'

export function GuestCards({
  guests,
  selected,
  guestById,
  groupById,
  seatText,
  actions,
}: {
  guests: readonly Guest[]
  selected: ReadonlySet<string>
  guestById: ReadonlyMap<string, Guest>
  groupById: ReadonlyMap<string, Group>
  seatText: ReadonlyMap<string, string>
  actions: GuestRowActions
}) {
  return (
    <ul className="space-y-2" data-testid="guest-cards">
      {guests.map((guest) => (
        <GuestCard
          key={guest.id}
          guest={guest}
          partner={guest.partnerId ? guestById.get(guest.partnerId) : undefined}
          groupById={groupById}
          seats={seatText.get(guest.id) ?? ''}
          selected={selected.has(guest.id)}
          actions={actions}
        />
      ))}
    </ul>
  )
}

const GuestCard = memo(function GuestCard({
  guest,
  partner,
  groupById,
  seats,
  selected,
  actions,
}: {
  guest: Guest
  partner: Guest | undefined
  groupById: ReadonlyMap<string, Group>
  seats: string
  selected: boolean
  actions: GuestRowActions
}) {
  const name = fullName(guest)
  const partners = usePartnerNames()
  const groups = guest.groupIds.map((id) => groupById.get(id)).filter((g): g is Group => g !== undefined)
  const facts = [`Side: ${sideLabel(partners, guest.side)}`, `RSVP: ${RSVP_LABEL[guest.rsvp]}`, guest.meal ? `Meal: ${guest.meal}` : null, guest.isChild ? 'Child' : null].filter(Boolean)
  return (
    <li
      className={`rounded-xl border bg-white p-2 ${selected ? 'border-blue-800 bg-blue-50' : 'border-stone-200'}`}
      data-testid="guest-card"
      data-guest-id={guest.id}
    >
      <div className="flex items-start gap-1">
        <CheckField checked={selected} onChange={(on) => actions.select(guest.id, on)} label={`Select ${name}`} />
        <div className="min-w-0 flex-1 py-2">
          <p className="break-words font-medium text-stone-900">
            {name}
            {guest.nickname && <span className="font-normal text-stone-600"> ({guest.nickname})</span>}
          </p>
          <p className="mt-0.5 text-sm text-stone-700">{facts.join(' · ')}</p>
          {partner && <p className="mt-0.5 text-sm text-stone-700">Partner: {fullName(partner)}</p>}
          {guest.household && <p className="mt-0.5 text-sm text-stone-700">Household: {guest.household}</p>}
          {groups.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {groups.map((g) => (
                <GroupChip key={g.id} name={g.name} color={g.color} />
              ))}
            </div>
          )}
          <p className="mt-0.5 text-sm text-stone-600">{seats ? `Seated: ${seats}` : 'Not seated'}</p>
          {guest.notes && <p className="mt-0.5 line-clamp-2 whitespace-pre-line break-words text-sm text-stone-600">{guest.notes}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <button
            type="button"
            onClick={() => actions.openEdit(guest)}
            aria-label={`Edit ${name}`}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-blue-900 hover:bg-blue-50"
            data-testid="edit-guest"
          >
            Edit
          </button>
          <DeleteButton name={name} onClick={() => actions.openDelete(guest)} />
        </div>
      </div>
    </li>
  )
})

/** Every field of one guest, for phones. Each field saves on its own, as in the table. */
export function GuestEditDialog({
  guest,
  partner,
  groupById,
  seats,
  actions,
  onClose,
}: {
  guest: Guest | null
  partner: Guest | undefined
  groupById: ReadonlyMap<string, Group>
  seats: string
  actions: GuestRowActions
  onClose(): void
}) {
  const name = guest ? fullName(guest) : ''
  const sideOptions = useSideOptions()
  const groups = guest ? guest.groupIds.map((id) => groupById.get(id)).filter((g): g is Group => g !== undefined) : []
  return (
    <Dialog open={guest !== null} onClose={onClose} title={guest ? name : 'Guest'} testId="guest-edit-dialog">
      {guest && (
        <div className="space-y-3">
          <Field label="First name">
            <EditableText value={guest.firstName} label={`First name of ${name}`} required onSave={(v) => v && actions.edit(guest, { firstName: v })} testId="edit-firstName" />
          </Field>
          <Field label="Last name">
            <EditableText value={guest.lastName} label={`Last name of ${name}`} required onSave={(v) => v && actions.edit(guest, { lastName: v })} testId="edit-lastName" />
          </Field>
          <Field label="Nickname">
            <EditableText value={guest.nickname} label={`Nickname of ${name}`} placeholder="Add" maxLength={100} onSave={(v) => actions.edit(guest, { nickname: v })} testId="edit-nickname" />
          </Field>
          <Field label="Partner">
            <button
              type="button"
              onClick={() => actions.openPartner(guest)}
              className="-mx-1 flex min-h-11 w-full items-center rounded-lg px-1 text-left text-sm hover:bg-stone-100"
              data-testid="edit-partner"
            >
              <span className="sr-only">Partner of {name}: </span>
              {partner ? fullName(partner) : <span className="text-stone-400">None. Pick one</span>}
            </button>
          </Field>
          <Field label="Household">
            <EditableText value={guest.household} label={`Household of ${name}`} placeholder="Add" onSave={(v) => actions.edit(guest, { household: v })} testId="edit-household" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <SelectField<GuestSide> showLabel value={guest.side} label="Side" options={sideOptions} onChange={(v) => actions.edit(guest, { side: v })} testId="edit-side" />
            <SelectField<GuestRsvp> showLabel value={guest.rsvp} label="RSVP" options={RSVP_OPTIONS} onChange={(v) => actions.edit(guest, { rsvp: v })} testId="edit-rsvp" />
          </div>
          <Field label="Meal">
            <EditableText value={guest.meal} label={`Meal of ${name}`} placeholder="Add" onSave={(v) => actions.edit(guest, { meal: v })} testId="edit-meal" />
          </Field>
          <CheckField checked={guest.isChild} label="Child" onChange={(v) => actions.edit(guest, { isChild: v })} testId="edit-child">
            Child
          </CheckField>
          <Field label="Groups">
            <button
              type="button"
              onClick={() => actions.openGroups(guest)}
              className="-mx-1 flex min-h-11 w-full flex-wrap items-center gap-1 rounded-lg px-1 py-1 text-left text-sm hover:bg-stone-100"
              data-testid="edit-groups"
            >
              <span className="sr-only">Groups of {name}: </span>
              {groups.length === 0 ? <span className="text-stone-400">None. Pick some</span> : groups.map((g) => <GroupChip key={g.id} name={g.name} color={g.color} />)}
            </button>
          </Field>
          <Field label="Notes">
            <EditableText value={guest.notes} label={`Notes on ${name}`} placeholder="Add" multiline onSave={(v) => actions.edit(guest, { notes: v })} testId="edit-notes" />
          </Field>
          <p className="text-sm text-stone-700">{seats ? `Seated: ${seats}` : 'Not seated in any layout.'}</p>
          <DialogActions>
            <button type="button" className={`${secondaryButton} text-red-700 hover:bg-red-50`} onClick={() => actions.openDelete(guest)}>
              Delete guest
            </button>
            <button type="button" className={secondaryButton} onClick={onClose}>
              Done
            </button>
          </DialogActions>
        </div>
      )}
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-stone-700" aria-hidden="true">
        {label}
      </p>
      {children}
    </div>
  )
}
