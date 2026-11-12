import { useSyncExternalStore } from 'react'
import { ApiRequestError } from '@/client/api'
import { tokenFromHash } from '@/client/one-time-link'

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/**
 * The token in this page's #fragment (src/client/one-time-link.ts).
 * `undefined` while the server renders and during hydration (the server never
 * sees the fragment), then the token, or null when the address has none.
 */
export function useLinkToken(): string | null | undefined {
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => null,
  )
  return hash === null ? undefined : tokenFromHash(hash)
}

/** The parts of a refusal the invite, reset and account screens act on. */
export type Refusal = { status: number; error: string | null; reason: string | null; message: string | null; retryAfterSeconds?: number }

/** A failed request's status and reply, or null when it was not a reply from the server. */
export function refusalOf(err: unknown): Refusal | null {
  if (!(err instanceof ApiRequestError)) return null
  const body = (err.body ?? {}) as { error?: unknown; reason?: unknown; message?: unknown; retryAfterSeconds?: unknown }
  return {
    status: err.status,
    error: typeof body.error === 'string' ? body.error : null,
    reason: typeof body.reason === 'string' ? body.reason : null,
    message: typeof body.message === 'string' ? body.message : null,
    retryAfterSeconds: typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined,
  }
}
