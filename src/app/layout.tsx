import type { Metadata, Viewport } from 'next'
import { BRAND_NAME, BRAND_NAVY } from '@/brand/brand'
import { brandFontVariables } from './fonts/brand-fonts'
import './globals.css'

// The tab icons and the manifest come from the files beside this one
// (favicon.ico, icon.svg, apple-icon.png, manifest.ts).
export const metadata: Metadata = {
  // Pages give their own name ('Guests'), which reads "Guests · Something Blueprint.".
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description: `${BRAND_NAME} Wedding guest lists and seating plans.`,
  applicationName: BRAND_NAME,
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: BRAND_NAVY,
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${brandFontVariables} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">{children}</body>
    </html>
  )
}
