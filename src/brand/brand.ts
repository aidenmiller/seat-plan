/**
 * The product's name and brand colors (the Something Blueprint. brand pack:
 * brand.md and tokens.css, light values). The artwork beside this file is
 * copied from the pack unchanged; the icons the browser asks for live in
 * src/app (favicon.ico, icon.svg, apple-icon.png, manifest.ts).
 *
 * The name is always written with its final period. Identifiers that still
 * say seat-plan (the backup format, storage keys, cookie names) are data, not
 * branding, and stay as they are.
 */
export const BRAND_NAME = 'Something Blueprint.'

/** Heritage navy: the mark, primary buttons, taken seats, and the browser's theme color. */
export const BRAND_NAVY = '#1e3a8a'

/** Wedding ivory: the page background. */
export const BRAND_IVORY = '#fff9f0'

/**
 * The address of an imported image. Next gives { src, width, height } and
 * serves the file from /_next/static/media/, which the sign-in proxy lets
 * through; Vitest gives the address itself.
 */
export function assetUrl(file: unknown): string {
  return typeof file === 'string' ? file : (file as { src: string }).src
}
