/**
 * Typed calls for the admin-only changes (src/shared/admin-api.ts), through
 * the same helper as every other screen (src/client/api.ts), so each throws an
 * ApiRequestError on a non-2xx reply. Changing a member's role and taking
 * someone out use the wedding's own member routes (accounts-api.ts), which an
 * admin may use on any wedding.
 */
import type { AdminWedding, WeddingMember } from '@/shared/accounts-api'
import type { AdminAddMemberBody, AdminVenue, AdminVenuePatchBody, TransferOwnershipBody } from '@/shared/admin-api'
import { request } from './api'

const enc = encodeURIComponent

export const undeleteWedding = (weddingId: string) => request<AdminWedding>('POST', `/api/admin/weddings/${enc(weddingId)}/undelete`)

export const adminAddMember = (weddingId: string, body: AdminAddMemberBody) =>
  request<WeddingMember>('POST', `/api/admin/weddings/${enc(weddingId)}/members`, body)

export const transferOwnership = (weddingId: string, body: TransferOwnershipBody) =>
  request<WeddingMember[]>('POST', `/api/admin/weddings/${enc(weddingId)}/transfer`, body)

export const changeVenueAsAdmin = (venueId: string, body: AdminVenuePatchBody) =>
  request<AdminVenue>('PATCH', `/api/admin/venues/${enc(venueId)}`, body)
