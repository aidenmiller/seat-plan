/**
 * Retry delays for layout saves (PLAN section 5, "Retries"): 1 s, 2 s, 4 s,
 * 8 s, 16 s, then 30 s for every later try, each moved up or down by as much
 * as 20% so tabs that failed together do not all retry in the same instant.
 * Pure: the random source is passed in.
 */

export const BACKOFF_BASE_MS = 1000
export const BACKOFF_CAP_MS = 30_000
export const BACKOFF_JITTER = 0.2

/** The delay before the given try, without jitter. `attempt` counts failed tries, starting at 1. */
export function baseDelay(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt))
  // 2 ** 15 is far past the cap; stopping there keeps the number finite.
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.min(n - 1, 15))
}

/**
 * The delay before the given try, with jitter. `random` returns a number in
 * [0, 1) like Math.random. The result never passes the 30 s cap.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = baseDelay(attempt)
  const r = Math.min(1, Math.max(0, random()))
  const factor = 1 + (r * 2 - 1) * BACKOFF_JITTER
  return Math.round(Math.min(BACKOFF_CAP_MS, base * factor))
}
