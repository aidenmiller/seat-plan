/** Choices and column names shared by the guest screens. Side choices carry the wedding's names (useSideOptions). */
import type { GuestSortKey } from '@/domain/guest-list'
import type { GuestRsvp } from '@/shared/api'

export const RSVP_OPTIONS: readonly { value: GuestRsvp; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'pending', label: 'Pending' },
  { value: 'no', label: 'No' },
]

export const RSVP_LABEL: Record<GuestRsvp, string> = { yes: 'Yes', pending: 'Pending', no: 'No' }

/** The guest table's columns, in order, each sortable. */
export const GUEST_COLUMNS: readonly { key: GuestSortKey; label: string }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'nickname', label: 'Nickname' },
  { key: 'partner', label: 'Partner' },
  { key: 'household', label: 'Household' },
  { key: 'side', label: 'Side' },
  { key: 'rsvp', label: 'RSVP' },
  { key: 'meal', label: 'Meal' },
  { key: 'isChild', label: 'Child' },
  { key: 'groups', label: 'Groups' },
  { key: 'notes', label: 'Notes' },
  { key: 'seats', label: 'Seated at' },
]

export const SORT_LABEL: Record<GuestSortKey, string> = Object.fromEntries(GUEST_COLUMNS.map((c) => [c.key, c.label])) as Record<
  GuestSortKey,
  string
>
