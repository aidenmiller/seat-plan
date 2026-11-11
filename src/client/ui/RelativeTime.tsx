'use client'

/**
 * "5 minutes ago", kept up to date. Renders an empty <time> on the server and
 * during hydration (the server's clock and time zone are not the viewer's),
 * then fills in. The full date and time show on hover.
 */
import { clockTime, relativeTime } from '@/domain/wording'
import { useNow } from './clock'

export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const now = useNow()
  const date = new Date(iso)
  const valid = Number.isFinite(date.getTime())
  const title = now !== null && valid ? `${date.toLocaleDateString()} ${clockTime(date)}` : undefined
  return (
    <time dateTime={iso} title={title} className={className}>
      {now === null ? '' : relativeTime(iso, now)}
    </time>
  )
}

/** "Edited 5 minutes ago by Noa". */
export function EditedLine({ updatedAt, editedBy }: { updatedAt: string; editedBy: string | null }) {
  return (
    <>
      Edited <RelativeTime iso={updatedAt} />
      {editedBy ? ` by ${editedBy}` : ''}
    </>
  )
}
