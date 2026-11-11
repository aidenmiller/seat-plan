import 'server-only'
import { after } from 'next/server'

/**
 * Runs bookkeeping (session touches, the activity log) after the reply has
 * gone, using Next's after(). Outside a request, where after() throws (a
 * script, or Vitest calling a handler directly), the work runs here and now
 * instead, and is awaited. Either way an error in the work is logged, never
 * thrown: bookkeeping must not break the request it follows.
 */
export async function runAfterResponse(work: () => Promise<unknown>): Promise<void> {
  const safe = async () => {
    try {
      await work()
    } catch (err) {
      console.error('after response:', err instanceof Error ? err.message : err)
    }
  }
  try {
    after(safe)
  } catch {
    await safe()
  }
}
