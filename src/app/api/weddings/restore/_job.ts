import 'server-only'
import { uuid } from '@/shared/api'

/** The context of a handler under restore/[jobId]. */
export type JobContext = { params: Promise<{ jobId: string; templateId?: string }> }

/** A route param when it is a uuid, lower-cased; null otherwise (the caller answers 404). */
export function uuidOrNull(value: string | undefined): string | null {
  return value !== undefined && uuid.safeParse(value).success ? value.toLowerCase() : null
}
