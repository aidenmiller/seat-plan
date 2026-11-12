/**
 * The Something Blueprint. logo from the brand pack (src/brand): the mark and
 * the horizontal lockup in full color, and the lockup in white for navy
 * (brand.md, "Logo use": white artwork on navy).
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
import horizontalWhiteFile from '@/brand/logo-horizontal-white.svg'
import horizontalFile from '@/brand/logo-horizontal.svg'
import markFile from '@/brand/logo-mark.svg'

/** Each file's own size (its viewBox), and the narrowest the brand allows it on screen. */
const ART = {
  mark: { file: markFile, width: 260, height: 260, minWidth: 24 },
  horizontal: { file: horizontalFile, width: 1640, height: 280, minWidth: 320 },
  'horizontal-white': { file: horizontalWhiteFile, width: 1640, height: 280, minWidth: 320 },
} as const

export type LogoVariant = keyof typeof ART

export const LOGO_MIN_WIDTH: Record<LogoVariant, number> = {
  mark: ART.mark.minWidth,
  horizontal: ART.horizontal.minWidth,
  'horizontal-white': ART['horizontal-white'].minWidth,
}

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
