import type { MetadataRoute } from 'next'
import { assetUrl, BRAND_IVORY, BRAND_NAME, BRAND_NAVY } from '@/brand/brand'
import icon192 from '@/brand/app-icon-192.png'
import icon512 from '@/brand/app-icon-512.png'
import iconMaskable from '@/brand/app-icon-maskable-512.png'

/**
 * The web app manifest (/manifest.webmanifest): the name and icons a phone
 * uses when the site is added to its home screen. The icons are imported, so
 * they are served from /_next/static/media/ like the logo. The site still
 * opens in the browser (display: browser), as it always has.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: 'Blueprint.',
    description: 'Wedding guest lists and seating plans.',
    start_url: '/',
    display: 'browser',
    background_color: BRAND_IVORY,
    theme_color: BRAND_NAVY,
    icons: [
      { src: assetUrl(icon192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: assetUrl(icon512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: assetUrl(iconMaskable), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
