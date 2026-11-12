import 'server-only'
import type { StoredBackupHead, StoredBackupImage } from '@/domain/backup/schema'
import { sha256Hex } from './hash'

/** A backup that cannot be trusted: a missing or changed image, a bad file. The message names ids only. */
export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupIntegrityError'
  }
}

/** Reads one image's bytes: from the database for a download of the wedding as it is now, from the backup store for a stored backup. */
export type ImageReader = (ref: StoredBackupImage) => Promise<Uint8Array | null>

/**
 * The backup file (format seat-plan-backup, version 2) as a stream of UTF-8
 * JSON: the head as it is, then each image with its bytes as base64, read one
 * at a time as the stream is pulled, so a file with large floor plan images
 * is never held whole (DECISIONS 101). The same writer serves the live
 * download (GET /api/weddings/:id/backup) and downloads of stored backups, so
 * a stored backup comes back as a normal file that Restore from file reads.
 *
 * Each image's bytes are checked against the sha256 the head names before
 * they are written. A missing image or a mismatch errors the stream: the
 * download fails rather than hand over a backup that would not restore.
 */
export function backupFileStream(head: StoredBackupHead, readImage: ImageReader): ReadableStream<Uint8Array> {
  const { images, ...rest } = head
  const encoder = new TextEncoder()
  const opening = JSON.stringify(rest)
  let next = 0
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // The head is one JSON object; the images list goes in before its closing brace.
      controller.enqueue(encoder.encode(`${opening.slice(0, -1)},"images":[`))
    },
    async pull(controller) {
      if (next < images.length) {
        const ref = images[next]!
        const bytes = await readImage(ref)
        if (!bytes) throw new BackupIntegrityError(`The floor plan image ${ref.id} is missing from the backup`)
        if (sha256Hex(bytes) !== ref.sha256) throw new BackupIntegrityError(`The floor plan image ${ref.id} does not match its checksum`)
        const entry = JSON.stringify({
          id: ref.id,
          templateId: ref.templateId,
          contentType: ref.contentType,
          width: ref.width,
          height: ref.height,
          sha256: ref.sha256,
          data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'),
        })
        controller.enqueue(encoder.encode(`${next > 0 ? ',' : ''}${entry}`))
        next++
        return
      }
      controller.enqueue(encoder.encode(']}'))
      controller.close()
    },
  })
}
