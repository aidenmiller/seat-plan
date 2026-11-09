import type { MetadataRoute } from 'next'

/**
 * Crawlers may fetch pages so they can read the noindex header on every
 * response. Blocking them here would hide that header, and a blocked URL can
 * still show up in search results when another page links to it.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/' }] }
}
