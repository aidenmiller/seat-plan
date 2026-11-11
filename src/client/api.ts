/**
 * Typed fetch helpers for every route the screens call, using the contract in
 * src/shared/api.ts. Each one throws an ApiRequestError on a non-2xx reply
 * (or status 0 when the server could not be reached). Layout saves go through
 * the save engine (src/client/sync), and guest and group field edits through
 * the row queue (src/client/sync/row-save.ts), not through here.
 */
import type {
  AddGroupMembersBody,
  AddGroupMembersReply,
  ApiError,
  BulkGuestsBody,
  CreateGroupBody,
  CreateGuestBody,
  CreateLayoutBody,
  CreateWeddingBody,
  DeleteGuestReply,
  DuplicateLayoutBody,
  Group,
  Guest,
  GuestDeleteSummary,
  GuestSeatPlace,
  ImportCommitBody,
  ImportCommitResult,
  ImportPreview,
  ImportPreviewBody,
  LayoutDeleteSummary,
  LayoutDetail,
  LayoutSummary,
  LayoutVersionInfo,
  UpdateGroupBody,
  UpdateGuestBody,
  UpdateGuestReply,
  UpdateLayoutBody,
  UpdateWeddingBody,
  AcceptImportBody,
  CreateVenueBody,
  DuplicateVenueBody,
  FloorplanImportBody,
  FloorplanImportLine,
  RenameVenueBody,
  RestoreRevisionBody,
  SaveVenueBody,
  SaveVenueConflict,
  SaveVenueOk,
  VenueDeleteSummary,
  VenueDetail,
  VenueImageInfo,
  VenueRevisionList,
  VenueSummary,
  VenueWallCheck,
  WeddingDeleteSummary,
  WeddingSummary,
  CoupleRuleBody,
  CoupleRuleReply,
  CreateRuleBody,
  StoredRule,
  UpdateRuleBody,
  CreateShareLinkBody,
  RestoredLayout,
  RestoredTemplate,
  RestoreStarted,
  ShareLink,
  UpdateShareLinkBody,
} from '@/shared/api'
import type { BackupLayoutInput, BackupTemplateInput, RestoreStartInput } from '@/domain/backup/schema'

export class ApiRequestError extends Error {
  /** The HTTP status, or 0 when no answer came back. */
  readonly status: number
  /** The parsed JSON reply, or null. */
  readonly body: unknown

  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.body = body
  }
}

function isApiError(value: unknown): value is ApiError {
  return Boolean(value) && typeof value === 'object' && typeof (value as ApiError).error === 'string'
}

/** A plain sentence for a failed request, for showing next to the button that sent it. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return 'Something went wrong. Try again.'
  // 409, 413, 415 and 503 replies carry a plain sentence to show (src/shared/api.ts).
  if ([409, 413, 415, 503].includes(error.status) && isApiError(error.body) && error.body.message) {
    return error.body.message
  }
  switch (error.status) {
    case 0:
      return 'Could not reach the server. Check your connection and try again.'
    case 401:
      return 'You were signed out. Reload the page to sign in again.'
    case 404:
    case 410:
      return 'This was deleted, or it no longer exists.'
    case 422: {
      const issue = isApiError(error.body) ? error.body.issues?.[0] : undefined
      if (issue) {
        // Issues read "field: message"; the message alone is the useful part.
        const text = issue.includes(': ') ? issue.slice(issue.indexOf(': ') + 2) : issue
        return text.endsWith('.') ? text : `${text}.`
      }
      return 'The server could not accept that.'
    }
    default:
      return error.status >= 500 ? 'The server had a problem. Try again.' : 'Something went wrong. Try again.'
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiRequestError(0, null, 'Could not reach the server.')
  }
  const text = await res.text().catch(() => '')
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const code = isApiError(data) ? data.error : `HTTP ${res.status}`
    throw new ApiRequestError(res.status, data, `${method} ${path} failed: ${code}`)
  }
  return data as T
}

const enc = encodeURIComponent

// ---------- Weddings ----------

export const listWeddings = () => request<WeddingSummary[]>('GET', '/api/weddings')

export const createWedding = (body: CreateWeddingBody) => request<WeddingSummary>('POST', '/api/weddings', body)

export const getWedding = (id: string) => request<WeddingSummary>('GET', `/api/weddings/${enc(id)}`)

export const updateWedding = (id: string, body: UpdateWeddingBody) =>
  request<WeddingSummary>('PATCH', `/api/weddings/${enc(id)}`, body)

export const deleteWedding = (id: string) =>
  request<{ ok: true }>('DELETE', `/api/weddings/${enc(id)}`, { confirm: 'delete' })

export const weddingDeleteSummary = (id: string) =>
  request<WeddingDeleteSummary>('GET', `/api/weddings/${enc(id)}/delete-summary`)

// ---------- Layouts ----------

export const listLayouts = (weddingId: string) =>
  request<LayoutSummary[]>('GET', `/api/weddings/${enc(weddingId)}/layouts`)

export const createLayout = (weddingId: string, body: CreateLayoutBody) =>
  request<LayoutDetail>('POST', `/api/weddings/${enc(weddingId)}/layouts`, body)

export const getLayout = (id: string) => request<LayoutDetail>('GET', `/api/layouts/${enc(id)}`)

/** Rename, or change the template. Leaves the version alone. */
export const updateLayout = (id: string, body: UpdateLayoutBody) =>
  request<LayoutDetail>('PATCH', `/api/layouts/${enc(id)}`, body)

export const deleteLayout = (id: string) =>
  request<{ ok: true }>('DELETE', `/api/layouts/${enc(id)}`, { confirm: 'delete' })

export const layoutDeleteSummary = (id: string) =>
  request<LayoutDeleteSummary>('GET', `/api/layouts/${enc(id)}/delete-summary`)

/** A copy with the same seats, or (with `canvas`) "Keep mine as a new copy". */
export const duplicateLayout = (id: string, body: DuplicateLayoutBody) =>
  request<LayoutDetail>('POST', `/api/layouts/${enc(id)}/duplicate`, body)

export const layoutVersion = (id: string) => request<LayoutVersionInfo>('GET', `/api/layouts/${enc(id)}/version`)

// ---------- Venues ----------

export const listVenues = () => request<VenueSummary[]>('GET', '/api/venues')

/** 201 VenueDetail: a new, empty template. Send an id so a retry gives the same template back. */
export const createVenue = (body: CreateVenueBody) => request<VenueDetail>('POST', '/api/venues', body)

export const getVenue = (id: string) => request<VenueDetail>('GET', `/api/venues/${enc(id)}`)

/** The template editor's save. 409 SaveVenueConflict when someone saved since baseVersion; 410 when deleted. */
export const saveVenue = (id: string, body: SaveVenueBody) => request<SaveVenueOk>('PUT', `/api/venues/${enc(id)}`, body)

/** Rename. Leaves the version alone. */
export const renameVenue = (id: string, body: RenameVenueBody) => request<VenueDetail>('PATCH', `/api/venues/${enc(id)}`, body)

/** 409 VenueInUse (with the layouts) while live layouts use the template. */
export const deleteVenue = (id: string) => request<{ ok: true }>('DELETE', `/api/venues/${enc(id)}`, { confirm: 'delete' })

export const venueDeleteSummary = (id: string) => request<VenueDeleteSummary>('GET', `/api/venues/${enc(id)}/delete-summary`)

/** A copy with the same fixed items, reference and reference image. */
export const duplicateVenue = (id: string, body: DuplicateVenueBody) =>
  request<VenueDetail>('POST', `/api/venues/${enc(id)}/duplicate`, body)

export const listVenueRevisions = (id: string) => request<VenueRevisionList>('GET', `/api/venues/${enc(id)}/revisions`)

/** Puts a revision back as a new save ("Undo import" restores VenueRevisionList.undoImportRevisionId). */
export const restoreVenueRevision = (id: string, revisionId: string, body: RestoreRevisionBody) =>
  request<SaveVenueOk>('POST', `/api/venues/${enc(id)}/revisions/${enc(revisionId)}/restore`, body)

/**
 * The 409 body of a venue save, accepted import or restore: someone saved the
 * template since the baseVersion sent. Null for any other error.
 */
export function venueConflictOf(error: unknown): SaveVenueConflict | null {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return null
  const body = error.body as Partial<SaveVenueConflict> | null
  if (!body || typeof body !== 'object' || body.error !== 'conflict' || typeof body.version !== 'number') return null
  return {
    ...body,
    editedBy: typeof body.editedBy === 'string' ? body.editedBy : null,
    editedById: typeof body.editedById === 'string' ? body.editedById : null,
  } as SaveVenueConflict
}

/** Saves an import draft into the template in one go. Answers like saveVenue. */
export const acceptVenueImport = (id: string, body: AcceptImportBody) =>
  request<SaveVenueOk>('POST', `/api/venues/${enc(id)}/accept-import`, body)

/** Every live layout using the template, with the tables a saved wall runs through. */
export const venueWallCheck = (id: string) => request<VenueWallCheck>('GET', `/api/venues/${enc(id)}/wall-check`)

/** Where a stored image is served (behind the site cookie). */
export const venueImageUrl = (id: string, imageId: string) => `/api/venues/${enc(id)}/images/${enc(imageId)}`

/**
 * Uploads a PNG or JPEG (at most MAX_VENUE_IMAGE_BYTES) as the raw body. The
 * template does not use it until Accept. 413 too large, 415 not a PNG or JPEG.
 */
export function uploadVenueImage(id: string, image: Blob): Promise<VenueImageInfo> {
  return sendRaw<VenueImageInfo>('POST', `/api/venues/${enc(id)}/images`, image)
}

/** Sends a file as the raw request body. */
async function sendRaw<T>(method: 'POST' | 'PUT', path: string, image: Blob): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': image.type || 'application/octet-stream' },
      body: image,
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiRequestError(0, null, 'Could not reach the server.')
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = isApiError(data) ? data.error : `HTTP ${res.status}`
    throw new ApiRequestError(res.status, data, `${method} ${path} failed: ${code}`)
  }
  return data as T
}

export type FloorplanImportResult = Extract<FloorplanImportLine, { type: 'draft' | 'error' }>

/**
 * Runs the AI import on an uploaded image. Calls onProgress for each progress
 * line and resolves with the final draft or error line. Throws an
 * ApiRequestError when the server refuses before starting (404, 422, 503
 * not_configured) or the connection drops; an aborted signal rejects too.
 */
export async function runFloorplanImport(
  id: string,
  body: FloorplanImportBody,
  options: { signal?: AbortSignal; onProgress?: (line: Extract<FloorplanImportLine, { type: 'progress' }>) => void } = {},
): Promise<FloorplanImportResult> {
  const path = `/api/venues/${enc(id)}/import`
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: options.signal,
    })
  } catch (err) {
    if (options.signal?.aborted) throw err
    throw new ApiRequestError(0, null, 'Could not reach the server.')
  }
  if (!res.ok || !res.body) {
    const data: unknown = await res.json().catch(() => null)
    const code = isApiError(data) ? data.error : `HTTP ${res.status}`
    throw new ApiRequestError(res.status, data, `POST ${path} failed: ${code}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  const take = (line: string): FloorplanImportResult | null => {
    if (!line.trim()) return null
    const parsed = JSON.parse(line) as FloorplanImportLine
    if (parsed.type === 'progress') {
      options.onProgress?.(parsed)
      return null
    }
    return parsed
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffered += decoder.decode(value, { stream: !done })
      let newline = buffered.indexOf('\n')
      while (newline >= 0) {
        const final = take(buffered.slice(0, newline))
        buffered = buffered.slice(newline + 1)
        if (final) return final
        newline = buffered.indexOf('\n')
      }
      if (done) break
    }
    const final = take(buffered)
    if (final) return final
  } catch (err) {
    if (options.signal?.aborted) throw err
    throw new ApiRequestError(0, null, 'The connection dropped during the import.')
  } finally {
    reader.releaseLock()
  }
  throw new ApiRequestError(0, null, 'The connection dropped during the import.')
}

// ---------- Guests ----------

export const listGuests = (weddingId: string) => request<Guest[]>('GET', `/api/weddings/${enc(weddingId)}/guests`)

/** One guest added by hand. Send an id so a retry gives the same guest back. */
export const createGuest = (weddingId: string, body: CreateGuestBody) =>
  request<Guest>('POST', `/api/weddings/${enc(weddingId)}/guests`, body)

/**
 * Saves the fields sent, at once. Screens queue field edits through the row
 * queue instead; this is for changes that need the answer before going on.
 */
export const updateGuest = (id: string, body: UpdateGuestBody) =>
  request<UpdateGuestReply>('PATCH', `/api/guests/${enc(id)}`, body)

/** Removes the guest: their seats in every layout and their partner link are cleared. */
export const deleteGuest = (id: string) => request<DeleteGuestReply>('DELETE', `/api/guests/${enc(id)}`)

export const guestDeleteSummary = (id: string) =>
  request<GuestDeleteSummary>('GET', `/api/guests/${enc(id)}/delete-summary`)

/** Pasted names, after the preview: all or nothing. */
export const addGuestsBulk = (weddingId: string, body: BulkGuestsBody) =>
  request<Guest[]>('POST', `/api/weddings/${enc(weddingId)}/guests/bulk`, body)

/** The re-import summary. Saves nothing. */
export const previewGuestImport = (weddingId: string, body: ImportPreviewBody) =>
  request<ImportPreview>('POST', `/api/weddings/${enc(weddingId)}/guests/import/preview`, body)

/** Applies the import in one transaction. 422 needs_review, 409 stale: see ImportCommitBody. */
export const commitGuestImport = (weddingId: string, body: ImportCommitBody) =>
  request<ImportCommitResult>('POST', `/api/weddings/${enc(weddingId)}/guests/import/commit`, body)

/** The guest list as a CSV download (a plain link: the server names the file). */
/** Where each live guest sits in the wedding's live layouts (the Guests page's "Seated at" column). */
export const listGuestSeats = (weddingId: string) =>
  request<GuestSeatPlace[]>('GET', `/api/weddings/${enc(weddingId)}/guests/seats`)

export const guestsExportUrl = (weddingId: string) => `/api/weddings/${enc(weddingId)}/guests/export`

// ---------- Groups ----------

export const listGroups = (weddingId: string) => request<Group[]>('GET', `/api/weddings/${enc(weddingId)}/groups`)

/** 409 name_taken when a group has that name, ignoring case. */
export const createGroup = (weddingId: string, body: CreateGroupBody) =>
  request<Group>('POST', `/api/weddings/${enc(weddingId)}/groups`, body)

/** Rename or recolor at once (screens queue these through the row queue). */
export const updateGroup = (id: string, body: UpdateGroupBody) => request<Group>('PATCH', `/api/groups/${enc(id)}`, body)

/** Deletes the group outright; its guests stay. */
export const deleteGroup = (id: string) => request<{ ok: true }>('DELETE', `/api/groups/${enc(id)}`)

/** Guests already in the group are skipped. */
export const addGroupMembers = (groupId: string, body: AddGroupMembersBody) =>
  request<AddGroupMembersReply>('POST', `/api/groups/${enc(groupId)}/members`, body)

export const removeGroupMember = (groupId: string, guestId: string) =>
  request<Group>('DELETE', `/api/groups/${enc(groupId)}/members/${enc(guestId)}`)

// ---------- Rules ----------

export const listRules = (weddingId: string) => request<StoredRule[]>('GET', `/api/weddings/${enc(weddingId)}/rules`)

export const createRule = (weddingId: string, body: CreateRuleBody) =>
  request<StoredRule>('POST', `/api/weddings/${enc(weddingId)}/rules`, body)

/** Only the changed fields. guestIds replaces the rule's guests. */
export const updateRule = (id: string, body: UpdateRuleBody) => request<StoredRule>('PATCH', `/api/rules/${enc(id)}`, body)

export const deleteRule = (id: string) => request<{ ok: true }>('DELETE', `/api/rules/${enc(id)}`)

/** Switches a couple rule on both partners. 409 when they are no longer partners. */
export const setCoupleRule = (body: CoupleRuleBody) => request<CoupleRuleReply>('PATCH', '/api/rules/couple', body)

// ---------- Share links ----------

export const listWeddingShareLinks = (weddingId: string) =>
  request<ShareLink[]>('GET', `/api/weddings/${enc(weddingId)}/share-links`)

export const listLayoutShareLinks = (layoutId: string) => request<ShareLink[]>('GET', `/api/layouts/${enc(layoutId)}/share-links`)

export const createShareLink = (layoutId: string, body: CreateShareLinkBody) =>
  request<ShareLink>('POST', `/api/layouts/${enc(layoutId)}/share-links`, body)

/** A new password, or enabled: false, signs out everyone using the link. */
export const updateShareLink = (id: string, body: UpdateShareLinkBody) =>
  request<ShareLink>('PATCH', `/api/share-links/${enc(id)}`, body)

export const deleteShareLink = (id: string) => request<{ ok: true }>('DELETE', `/api/share-links/${enc(id)}`)

// ---------- Backup and restore ----------

export const backupUrl = (weddingId: string) => `/api/weddings/${enc(weddingId)}/backup`

export const startRestore = (body: RestoreStartInput) => request<RestoreStarted>('POST', '/api/weddings/restore', body)

export const restoreTemplate = (jobId: string, body: BackupTemplateInput) =>
  request<RestoredTemplate>('POST', `/api/weddings/restore/${enc(jobId)}/templates`, body)

/** The image of a template the restore copied, as raw bytes. `templateId` is its id in the backup. */
export const restoreTemplateImage = (jobId: string, templateId: string, image: Blob) =>
  sendRaw<{ ok: true }>('PUT', `/api/weddings/restore/${enc(jobId)}/templates/${enc(templateId)}/image`, image)

export const restoreLayout = (jobId: string, body: BackupLayoutInput) =>
  request<RestoredLayout>('POST', `/api/weddings/restore/${enc(jobId)}/layouts`, body)
