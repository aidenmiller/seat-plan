/**
 * The save engines alive in this page (the open layout's saver, the venue
 * editor's saver and the guest and group queue), so signing out can reach
 * them: send what waits, tell whether anything is still unsaved, and stop
 * them before the user's storage is deleted (src/client/sign-out.ts).
 */

export type LiveSaver = {
  /** Send what waits now. Resolves when the attempt settles. */
  flush(): Promise<void>
  hasUnsavedChanges(): boolean
  /** Stop sending and storing; resolves once the storage writes already queued have finished. */
  stop(): Promise<void>
  /** The page's own user signed in again: a saver stopped because someone else signed in (or the session ended) sends again. */
  resume?(): void
}

const live = new Set<LiveSaver>()
let leavingForSignOut = false

/** Adds a saver for as long as it lives. Returns the function that takes it out again. */
export function registerSaver(saver: LiveSaver): () => void {
  live.add(saver)
  return () => {
    live.delete(saver)
  }
}

/** True while any live saver holds edits the server has not confirmed. */
export function anyUnsaved(): boolean {
  for (const saver of live) {
    try {
      if (saver.hasUnsavedChanges()) return true
    } catch {
      return true
    }
  }
  return false
}

/**
 * Sends what every live saver holds, waiting at most `waitMs`. Resolves with
 * whether anything is still unsaved after that.
 */
export async function flushAll(waitMs = 3000): Promise<{ unsaved: boolean }> {
  const flushes = [...live].map((saver) => saver.flush().catch(() => undefined))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs)
  })
  await Promise.race([Promise.all(flushes), timeout])
  clearTimeout(timer)
  return { unsaved: anyUnsaved() }
}

/** Lets every live saver stopped by someone else's sign-in send again: the page's own user signed in again. */
export function resumeAll(): void {
  for (const saver of [...live]) {
    try {
      saver.resume?.()
    } catch {
      // One broken saver must not keep the others stopped.
    }
  }
}

/** Stops every live saver and waits for their storage writes, so nothing writes after the user's data is deleted. */
export async function stopAll(): Promise<void> {
  const savers = [...live]
  live.clear()
  await Promise.all(savers.map((saver) => saver.stop().catch(() => undefined)))
}

/**
 * The page is about to leave because its user signed out (here or in another
 * tab), after they were asked about unsaved changes: the unload guards stop
 * asking again.
 */
export function markLeavingForSignOut(): void {
  leavingForSignOut = true
}

export function isLeavingForSignOut(): boolean {
  return leavingForSignOut
}
