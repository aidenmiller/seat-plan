'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { appFetch } from '../http'

export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function logout() {
    setBusy(true)
    try {
      await appFetch('/api/auth/logout', { method: 'POST', cache: 'no-store' })
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="h-11 rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
    >
      Log out
    </button>
  )
}
