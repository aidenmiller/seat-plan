'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function logout() {
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
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
