'use client'

import { expiresIn } from '@/domain/account-wording'
import { useNow } from '@/client/ui/clock'

/**
 * "Expires in 6 days", kept up to date. Empty on the server and during
 * hydration (the server's clock is not the viewer's), then filled in.
 */
export function ExpiresIn({ iso }: { iso: string }) {
  const now = useNow()
  return <time dateTime={iso}>{now === null ? '' : expiresIn(iso, now)}</time>
}
