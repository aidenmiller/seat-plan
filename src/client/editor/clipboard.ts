/**
 * The editor's clipboard (spec section 4: copy, paste, duplicate). Copies
 * stay in memory for this tab, so they paste into any layout opened in it,
 * and in localStorage under 'seat-plan:clipboard', so another tab on this
 * device can paste them. The newer of the two wins. The system clipboard is
 * left alone.
 *
 * Seats are emptied on copy (PLAN change 9): a pasted table never carries a
 * guest, and no guest ids sit in storage.
 */
import { z } from 'zod'
import { itemSchema, type Item } from '@/domain/canvas-schema'
import type { StorageLike } from './state/device-view'
import { emptySeats } from '@/domain/seats'

export const CLIPBOARD_KEY = 'seat-plan:clipboard'
/** Copies bigger than this stay in this tab only. */
export const MAX_STORED_CHARS = 2_000_000

export type ClipboardData = {
  /** Different for every copy, so pastes of one copy can step away from each other. */
  copyId: string
  layoutId: string
  copiedAt: number
  items: Item[]
}

export type EditorClipboard = {
  /** Copies items (in drawing order). Nothing happens for an empty list. */
  write(items: readonly Item[], layoutId: string): void
  /** The latest copy from this tab or another one on this device, or null. */
  read(): ClipboardData | null
  /** How many times this copy was pasted in this tab: the next paste in the same layout steps one grid step further. */
  pasteCount(copyId: string): number
  notePaste(copyId: string): void
}

const storedSchema = z.object({
  copyId: z.string().min(1).max(100),
  layoutId: z.string().max(100),
  copiedAt: z.number().finite(),
  items: z.array(itemSchema).max(3000),
})

/** One clipboard per tab, shared by every layout opened in it. */
const tabMemory: { data: ClipboardData | null; pastes: Map<string, number> } = { data: null, pastes: new Map() }

function clearSeats(item: Item): Item {
  if (item.kind === 'table') return { ...item, seats: emptySeats(item.seatCount) }
  if (item.kind === 'chairRow') return { ...item, seats: emptySeats(item.chairCount) }
  return item
}

function randomCopyId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type ClipboardOptions = {
  storage?: StorageLike | null
  now?: () => number
  /** Tests pass their own; the editor shares one per tab. */
  memory?: { data: ClipboardData | null; pastes: Map<string, number> }
}

export function createClipboard(options: ClipboardOptions = {}): EditorClipboard {
  const storage = options.storage ?? null
  const now = options.now ?? Date.now
  const memory = options.memory ?? tabMemory

  function readStored(): ClipboardData | null {
    if (!storage) return null
    try {
      const raw = storage.getItem(CLIPBOARD_KEY)
      if (!raw) return null
      const parsed = storedSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  return {
    write(items, layoutId) {
      if (items.length === 0) return
      const data: ClipboardData = { copyId: randomCopyId(), layoutId, copiedAt: now(), items: items.map(clearSeats) }
      memory.data = data
      if (!storage) return
      try {
        const text = JSON.stringify(data)
        if (text.length <= MAX_STORED_CHARS) storage.setItem(CLIPBOARD_KEY, text)
        else storage.removeItem(CLIPBOARD_KEY)
      } catch {
        // Full or blocked: this tab still has it.
      }
    },
    read() {
      const stored = readStored()
      const mine = memory.data
      if (stored && (!mine || stored.copiedAt > mine.copiedAt)) return stored
      return mine
    },
    pasteCount: (copyId) => memory.pastes.get(copyId) ?? 0,
    notePaste(copyId) {
      memory.pastes.set(copyId, (memory.pastes.get(copyId) ?? 0) + 1)
    },
  }
}
