/**
 * Autosave for the template editor: the layout save engine (layout-saver.ts)
 * pointed at PUT /api/venues/:id with the venue's save body. So the template
 * saves the way a layout does (DECISIONS 28): about a second after the last
 * edit, one save in flight, the same saveId on every retry, backoff, 409 as
 * a conflict that stops saving until the page resolves it, 410 when the
 * template was deleted.
 *
 * Templates keep no draft on the device (no IndexedDB), so the beforeunload
 * guard is what protects an edit that has not reached the server.
 */
import { createLayoutSaver } from '@/client/sync/layout-saver'
import type { DraftStore, LayoutSaver, LayoutSaverOptions } from '@/client/sync/types'
import type { TemplateDoc } from '@/domain/template-commands'
import type { SaveVenueBody } from '@/shared/api'
import { TEMPLATE_SAVER_MESSAGES } from './save-status'

/** No local drafts: every write reports that nothing was kept on the device. */
export const NO_TEMPLATE_DRAFTS: DraftStore<TemplateDoc> = {
  putDraft: async () => false,
  getDraft: async () => null,
  listDrafts: async () => [],
  deleteDraft: async () => true,
}

export type TemplateSaverOptions = Omit<LayoutSaverOptions<TemplateDoc>, 'layoutId' | 'tabId' | 'onDroppedSeats' | 'endpoint' | 'body' | 'drafts' | 'messages'> & {
  templateId: string
}

export function createTemplateSaver({ templateId, ...rest }: TemplateSaverOptions): LayoutSaver<TemplateDoc> {
  return createLayoutSaver<TemplateDoc>({
    ...rest,
    layoutId: `venue:${templateId}`,
    tabId: 'template-editor',
    onDroppedSeats: () => undefined,
    endpoint: `/api/venues/${encodeURIComponent(templateId)}`,
    body: (r): SaveVenueBody => ({ baseVersion: r.baseVersion, saveId: r.saveId, fixedItems: r.doc.items, reference: r.doc.reference }),
    drafts: NO_TEMPLATE_DRAFTS,
    messages: TEMPLATE_SAVER_MESSAGES,
  })
}
