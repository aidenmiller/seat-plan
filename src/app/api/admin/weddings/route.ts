import { json } from '@/server/api-route'
import { withAdmin } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { listWeddingsForAdmin } from '@/server/repo/admin-weddings'

/** Admins: AdminWedding[], every wedding (deleted ones too) with its members and counts, oldest first. */
export const GET = withAdmin(async () => json(await listWeddingsForAdmin(getDb())))
