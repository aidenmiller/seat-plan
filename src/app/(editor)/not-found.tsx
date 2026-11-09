import Link from 'next/link'
import { secondaryButton } from '@/client/ui/styles'

/** A wedding or layout that does not exist, or was deleted. */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="mt-2 text-stone-600">This page does not exist, or what it showed was deleted.</p>
      <Link href="/" className={`${secondaryButton} mt-6`}>
        Back to weddings
      </Link>
    </main>
  )
}
