/**
 * Typed fetch helpers for every route the screens call, using the contract in
 * src/shared/api.ts. Each one throws an ApiRequestError on a non-2xx reply
 * (or status 0 when the server could not be reached). Layout saves go through
 * the save engine (src/client/sync), not through here.
 */
import type {
  ApiError,
  CreateLayoutBody,
  CreateWeddingBody,
  DuplicateLayoutBody,
  LayoutDeleteSummary,
  LayoutDetail,
  LayoutSummary,
  LayoutVersionInfo,
  UpdateLayoutBody,
  UpdateWeddingBody,
  VenueSummary,
  WeddingDeleteSummary,
  WeddingSummary,
} from '@/shared/api'

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
