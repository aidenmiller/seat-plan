import type { Guest, UpdateGuestBody } from '@/shared/api'

/** What a guest row or card can do. One stable object per page, so rows that did not change do not redraw. */
export type GuestRowActions = {
  select(guestId: string, on: boolean): void
  /** Queue the changed fields (only what changed). */
  edit(guest: Guest, patch: UpdateGuestBody): void
  openPartner(guest: Guest): void
  openGroups(guest: Guest): void
  openDelete(guest: Guest): void
  /** Phones: every field of one guest in a dialog. */
  openEdit(guest: Guest): void
}
