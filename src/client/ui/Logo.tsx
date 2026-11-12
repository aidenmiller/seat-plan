/**
 * The Something Blueprint. logo, full color, from the brand pack (src/brand).
 *
 * The SVG files are imported, so Next serves them from /_next/static/media/
 * with a hashed name. The sign-in proxy lets that path through, so the logo
 * shows on the sign-in and setup pages too. Drawn with a plain <img>: the
 * files are vector, next/image would add nothing, and an image cannot run
 * anything inside the file. No hooks, so server and client components can
 * both use it.
 *
 * Brand rules (brand.md, "Logo use"): the horizontal lockup at 320 px wide or
 * more, the mark at 24 px or more; keep a quarter of the mark's circle clear
 * on every side. Each file already holds some of that room round the drawing.
 */
import { assetUrl, BRAND_NAME } from '@/brand/brand'
import horizontalFile from '@/brand/logo-horizontal.svg'
import markFile from '@/brand/logo-mark.svg'

/** Each file's own size (its viewBox), and the narrowest the brand allows it on screen. */
const ART = {
  mark: { file: markFile, width: 260, height: 260, minWidth: 24 },
  horizontal: { file: horizontalFile, width: 1640, height: 280, minWidth: 320 },
} as const

export type LogoVariant = keyof typeof ART

export const LOGO_MIN_WIDTH: Record<LogoVariant, number> = { mark: ART.mark.minWidth, horizontal: ART.horizontal.minWidth }

export function Logo({
  variant,
  width,
  decorative = false,
  className,
}: {
  variant: LogoVariant
  /** CSS px; never below LOGO_MIN_WIDTH. */
  width: number
  /** True when text beside the logo already names the product, so it is not read twice. */
  decorative?: boolean
  className?: string
}) {
  const art = ART[variant]
  const shown = Math.max(width, art.minWidth)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={assetUrl(art.file)}
      alt={decorative ? '' : BRAND_NAME}
      width={shown}
      height={Math.round((shown * art.height) / art.width)}
      className={className}
      draggable={false}
      data-logo={variant}
    />
  )
}

/**
 * Above the card on the sign-in and setup pages: the horizontal lockup at its
 * 320 px minimum on a phone (it fits 390 px with the page's 16 px margins),
 * as wide as the card from 640 px up, and an optional line in the editorial
 * serif.
 */
export function SignedOutBrand({ tagline }: { tagline?: string }) {
  return (
    <div className="mb-6 flex w-full max-w-sm flex-col items-center">
      <Logo variant="horizontal" width={320} className="h-auto w-80 sm:w-96" />
      {tagline && <p className="mt-2 font-editorial text-lg font-medium italic text-stone-600">{tagline}</p>}
    </div>
  )
}

/** A small mark and the name in text, for pages that only need to say whose they are (the share link's password page). */
export function BrandLine({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-center gap-2 text-sm font-semibold text-blue-900 ${className}`}>
      <Logo variant="mark" width={40} decorative />
      {BRAND_NAME}
    </p>
  )
}
