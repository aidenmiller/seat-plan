'use client'

/**
 * The guest list and groups a page shows: the server's copy (from the page,
 * or a reload through the API) with the row queue's waiting edits laid over
 * it, so an edit shows at once and stays shown until the server confirms it.
 * Replies from the queue update the server's copy; a refused edit reloads
 * the list and leaves a message to show.
 *
 * The lists are fetched again once after the page mounts: on browser Back
 * and Forward, Next shows the page from its client cache, with the lists as
 * they were on the first visit (before an import, say).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, listGroups, listGuests } from '@/client/api'
import { applyGroupMembers, applyGuestPatch, dropGroup, dropGuest, fullName } from '@/domain/guest-list'
import type { Group, Guest, UpdateGroupBody, UpdateGuestBody, UpdateGuestReply } from '@/shared/api'
import type { RowSaveEvent } from '@/client/sync/row-save'
import { useRowSaveEvents, useRowSaver, useRowSaverRevision } from './row-saver-hooks'

type Base = { guests: Guest[]; groups: Group[]; fromGuests: Guest[]; fromGroups: Group[] }

export type GuestData = {
  /** The list as it will be once every waiting edit lands. */
  guests: Guest[]
  groups: Group[]
  guestById: ReadonlyMap<string, Guest>
  groupById: ReadonlyMap<string, Group>
  /** Queue the changed fields of a guest (only what changed). */
  editGuest(id: string, patch: UpdateGuestBody): void
  /** Queue a rename or recolor. */
  editGroup(id: string, patch: UpdateGroupBody): void
  /** Guests the server just created. */
  addGuests(guests: readonly Guest[]): void
  /** A guest the server just removed. */
  removeGuest(id: string): void
  /** A group the server just created or changed (members included). */
  putGroup(group: Group): void
  /** A group the server just deleted. */
  removeGroup(id: string): void
  /** Fetch both lists again. Quiet: a failure leaves no message. */
  reload(options?: { quiet?: boolean }): Promise<void>
  /** The last refused edit or failed reload, in plain words. */
  message: string | null
  clearMessage(): void
}

function upsertGuests(list: readonly Guest[], updated: readonly Guest[]): Guest[] {
  const byId = new Map(updated.map((g) => [g.id, g]))
  const out = list.map((g) => byId.get(g.id) ?? g)
  const known = new Set(list.map((g) => g.id))
  for (const g of updated) if (!known.has(g.id)) out.push(g)
  return out
}

function isUpdateGuestReply(value: unknown): value is UpdateGuestReply {
  return Boolean(value) && typeof value === 'object' && 'guest' in (value as object) && Array.isArray((value as UpdateGuestReply).alsoChanged)
}

function isGroup(value: unknown): value is Group {
  return Boolean(value) && typeof value === 'object' && typeof (value as Group).id === 'string' && Array.isArray((value as Group).memberIds)
}

export function useGuestData(weddingId: string, initialGuests: Guest[], initialGroups: Group[]): GuestData {
  const [base, setBase] = useState<Base>(() => ({
    guests: initialGuests,
    groups: initialGroups,
    fromGuests: initialGuests,
    fromGroups: initialGroups,
  }))
  // A server refresh (router.refresh) brings new lists: start again from them.
  if (base.fromGuests !== initialGuests || base.fromGroups !== initialGroups) {
    setBase({ guests: initialGuests, groups: initialGroups, fromGuests: initialGuests, fromGroups: initialGroups })
  }
  const [message, setMessage] = useState<string | null>(null)
  const baseRef = useRef(base)
  useEffect(() => {
    baseRef.current = base
  })
  const saver = useRowSaver()
  const revision = useRowSaverRevision()
  /**
   * Goes up with every change made here (adds, deletes, saved edits). A
   * reload that started before one of them may lack it, so it is dropped and
   * asked for again rather than shown.
   */
  const changes = useRef(0)
  const touched = () => {
    changes.current += 1
  }

  const reload = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const startedAt = changes.current
        try {
          const [guests, groups] = await Promise.all([listGuests(weddingId), listGroups(weddingId)])
          if (changes.current !== startedAt) continue
          setBase((b) => ({ ...b, guests, groups }))
        } catch (err) {
          if (!options.quiet) setMessage(`Could not load the guest list again. ${errorMessage(err)}`)
        }
        return
      }
    },
    [weddingId],
  )

  useEffect(() => {
    let live = true
    const startedAt = changes.current
    Promise.all([listGuests(weddingId), listGroups(weddingId)]).then(
      ([guests, groups]) => {
        if (!live) return
        // A change made meanwhile may be missing from this answer: ask again.
        if (changes.current !== startedAt) void reload({ quiet: true })
        else setBase((b) => ({ ...b, guests, groups }))
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [weddingId, reload])

  const onEvent = useCallback(
    (event: RowSaveEvent) => {
      changes.current += 1
      if (event.type === 'saved') {
        if (event.kind === 'guest' && isUpdateGuestReply(event.reply)) {
          const reply = event.reply
          setBase((b) => ({ ...b, guests: upsertGuests(b.guests, [reply.guest, ...reply.alsoChanged]) }))
        } else if (event.kind === 'group' && isGroup(event.reply)) {
          const group = event.reply
          setBase((b) => (b.groups.some((g) => g.id === group.id) ? { ...b, groups: b.groups.map((g) => (g.id === group.id ? group : g)) } : b))
        }
        return
      }
      const b = baseRef.current
      const who = event.kind === 'guest' ? b.guests.find((g) => g.id === event.id) : b.groups.find((g) => g.id === event.id)
      const name = !who ? null : 'firstName' in who ? fullName(who) : who.name
      setMessage(name ? `Could not save the change to ${name}. ${event.message}` : `Could not save a change. ${event.message}`)
      void reload()
    },
    [reload],
  )
  useRowSaveEvents(onEvent)

  const guests = useMemo(() => {
    let list = base.guests
    if (!saver || revision < 0) return list
    for (const p of saver.pending().values()) if (p.kind === 'guest') list = applyGuestPatch(list, p.id, p.patch)
    return list
  }, [base.guests, saver, revision])

  const groups = useMemo(() => {
    if (!saver || revision < 0) return base.groups
    const pending = saver.pending()
    return base.groups.map((g) => {
      const p = pending.get(`group|${g.id}`)
      if (!p) return g
      const next = { ...g }
      if (typeof p.patch.name === 'string') next.name = p.patch.name
      if (typeof p.patch.color === 'string') next.color = p.patch.color.toUpperCase()
      return next
    })
  }, [base.groups, saver, revision])

  const guestById = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests])
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  return {
    guests,
    groups,
    guestById,
    groupById,
    editGuest(id, patch) {
      saver?.queue('guest', id, patch)
    },
    editGroup(id, patch) {
      saver?.queue('group', id, patch)
    },
    addGuests(added) {
      touched()
      setBase((b) => ({ ...b, guests: upsertGuests(b.guests, added) }))
    },
    removeGuest(id) {
      touched()
      setBase((b) => ({ ...b, guests: dropGuest(b.guests, id) }))
    },
    putGroup(group) {
      touched()
      setBase((b) => {
        const known = b.groups.some((g) => g.id === group.id)
        const groups = known ? b.groups.map((g) => (g.id === group.id ? group : g)) : [...b.groups, group]
        return { ...b, groups, guests: applyGroupMembers(b.guests, group) }
      })
    },
    removeGroup(id) {
      touched()
      setBase((b) => ({ ...b, groups: b.groups.filter((g) => g.id !== id), guests: dropGroup(b.guests, id) }))
    },
    reload,
    message,
    clearMessage: () => setMessage(null),
  }
}
