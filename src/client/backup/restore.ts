/**
 * Restore from a backup file, in the browser (PLAN section 7). The file is
 * checked with the same schema the server uses, then sent in steps, each
 * under Vercel's 4.5 MB request limit: the wedding's rows, then each venue
 * template and its floor plan image, then each layout. The job id is chosen
 * here and kept, so "Try again" after a failure picks up where it stopped:
 * every step the server already did answers the same way again.
 */
import { BACKUP_VERSION, backupFileSchema, type BackupFile } from '@/domain/backup/schema'
import type { RestoredLayout, RestoredTemplate, RestoreStarted } from '@/shared/api'
import {
  restoreLayout as postLayout,
  restoreTemplate as postTemplate,
  restoreTemplateImage as putImage,
  startRestore as postStart,
} from '../api'

export type ReadBackupResult = { ok: true; backup: BackupFile } | { ok: false; message: string }

/** Reads and checks a backup file. The message says plainly what is wrong. */
export async function readBackupFile(file: Blob): Promise<ReadBackupResult> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return { ok: false, message: 'This file is not a backup from Something Blueprint.' }
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== 'seat-plan-backup') {
    return { ok: false, message: 'This file is not a backup from Something Blueprint.' }
  }
  const parsed = backupFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.map(String).join('.')
    return { ok: false, message: `This backup file has a problem${where ? ` at ${where}` : ''}: ${issue?.message ?? 'unknown'}.` }
  }
  return { ok: true, backup: parsed.data }
}

export type RestoreProgress = { label: string; done: number; total: number }

export type RestoreSteps = {
  start: typeof postStart
  template: typeof postTemplate
  image: typeof putImage
  layout: typeof postLayout
}

const defaultSteps: RestoreSteps = { start: postStart, template: postTemplate, image: putImage, layout: postLayout }

/** Base64 to a Blob of the given type. */
export function base64ToBlob(data: string, type: string): Blob {
  const text = atob(data)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return new Blob([bytes], { type })
}

function countOf(n: number, total: number, noun: string): string {
  return total > 1 ? `${noun} ${n} of ${total}` : noun
}

/** Runs every step in order, reporting each before it is sent. Throws the first failure. */
export async function runRestore(
  backup: BackupFile,
  jobId: string,
  onProgress: (progress: RestoreProgress) => void,
  steps: RestoreSteps = defaultSteps,
): Promise<RestoreStarted & { droppedSeats: number }> {
  const withImage = backup.templates.filter((t) => t.imageId !== null).length
  const total = 1 + backup.templates.length + withImage + backup.layouts.length
  let done = 0
  const report = (label: string) => onProgress({ label, done, total })

  report('Guests, groups and rules')
  // The file reads as version 2 whatever version it was written in (backupFileSchema upgrades version 1).
  // Its members are never sent: a restore does not decide who can open the wedding.
  const started = await steps.start({
    format: backup.format,
    version: BACKUP_VERSION,
    jobId,
    wedding: backup.wedding,
    guests: backup.guests,
    groups: backup.groups,
    groupMembers: backup.groupMembers,
    rules: backup.rules,
    ruleGuests: backup.ruleGuests,
  })
  done += 1

  const images = new Map(backup.images.map((image) => [image.id, image]))
  for (const [i, template] of backup.templates.entries()) {
    report(countOf(i + 1, backup.templates.length, 'Venue'))
    const result: RestoredTemplate = await steps.template(jobId, template)
    done += 1
    if (template.imageId === null) continue
    const image = images.get(template.imageId)
    if (result.needsImage && image) {
      report(`Floor plan for ${template.name}`)
      await steps.image(jobId, template.id, base64ToBlob(image.data, image.contentType))
    }
    done += 1
  }

  let droppedSeats = 0
  for (const [i, layout] of backup.layouts.entries()) {
    report(countOf(i + 1, backup.layouts.length, 'Layout'))
    const result: RestoredLayout = await steps.layout(jobId, layout)
    droppedSeats += result.droppedSeats
    done += 1
  }
  onProgress({ label: 'Done', done, total })
  return { ...started, droppedSeats }
}
