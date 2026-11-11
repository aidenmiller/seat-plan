/**
 * The brand's fonts (brand.md, "Typography"), served from this site. The
 * files are copied from the @fontsource-variable/inter and
 * @fontsource/noto-serif-display 5.3.0 npm packages, under the SIL Open Font
 * License (Inter-OFL.txt, NotoSerifDisplay-OFL.txt), so neither the build nor
 * the browser ever asks Google for them.
 *
 * Each font sets a CSS variable on <html> (layout.tsx), and globals.css maps
 * them to Tailwind's font-sans and font-editorial. The plan's own labels keep
 * the system font (WORLD_FONT in src/client/editor/render/style.ts), and the
 * PDF export keeps its Noto Sans (public/fonts).
 */
import localFont from 'next/font/local'

/** Inter, the interface font: the Latin set, every weight in one variable file. */
export const inter = localFont({
  src: './inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
})

/**
 * Inter's Latin Extended set (Ł, ő, ș and the like), listed before Inter in
 * font-sans and limited to those characters, so the browser fetches it only
 * for a name that needs it. Without it those letters would fall back to Arial.
 */
export const interExtended = localFont({
  src: './inter-latin-ext-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-ext',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
})

/** Noto Serif Display for the odd editorial line (font-editorial), never for controls. Fetched only where used. */
export const notoSerifDisplay = localFont({
  src: [
    { path: './noto-serif-display-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './noto-serif-display-latin-400-italic.woff2', weight: '400', style: 'italic' },
    { path: './noto-serif-display-latin-500-italic.woff2', weight: '500', style: 'italic' },
  ],
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
  variable: '--font-noto-serif-display',
})

/** The class names that set the three variables, for <html>. */
export const brandFontVariables = `${inter.variable} ${interExtended.variable} ${notoSerifDisplay.variable}`
