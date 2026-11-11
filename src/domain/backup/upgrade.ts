/**
 * Version 1 backup files, from before partner names (migration 0007), read as
 * version 2: every one of them is Noa and Aiden's wedding, so the wedding gets
 * those names and each guest's side its place ('Noa' was partner 1, 'Aiden'
 * partner 2). Version 1 has no members. backupFileSchema and
 * restoreStartSchema run these, so everything after them sees version 2 only.
 */
import { legacySide } from '../partners'
import type { BackupFile, BackupFileV1, BackupGuest, BackupWedding, RestoreStart, RestoreStartV1 } from './schema'

type RowsV1 = { wedding: BackupFileV1['wedding']; guests: BackupFileV1['guests'] }

function upgradeRows(rows: RowsV1): { wedding: BackupWedding; guests: BackupGuest[] } {
  return {
    wedding: { ...rows.wedding, partner1Name: 'Noa', partner2Name: 'Aiden' },
    guests: rows.guests.map((g) => ({ ...g, side: legacySide(g.side) ?? 'both' })),
  }
}

/** A whole version 1 file as version 2. */
export function upgradeV1(file: BackupFileV1): BackupFile {
  return { ...file, version: 2, ...upgradeRows(file), members: [] }
}

/** The first restore step as an older browser sends it (version 1), as version 2. */
export function upgradeRestoreStartV1(start: RestoreStartV1): RestoreStart {
  return { ...start, version: 2, ...upgradeRows(start) }
}
