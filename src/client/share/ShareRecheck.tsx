'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** How often an open share page checks that the link still works (PLAN section 7, "Share view"). */
export const SHARE_RECHECK_MS = 60_000

/**
 * Keeps an open share page honest: it asks for the link's data when the page
 * regains focus and every 60 seconds. Once the link is turned off or its
 * password changed, the data route answers 401 and the page reloads, which
 * shows the password page. The plan view itself comes later.
 */
export function ShareRecheck({ token }: { token: string }) {
  const router = useRouter()
  useEffect(() => {
    let stopped = false
    async function check() {
      try {
        const res = await fetch(`/share/${token}/data`, { cache: 'no-store', referrerPolicy: 'no-referrer' })
        if (!stopped && (res.status === 401 || res.status === 404)) router.refresh()
      } catch {
        // Offline: try again on the next tick.
      }
    }
    const timer = window.setInterval(() => void check(), SHARE_RECHECK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router, token])
  return null
}
