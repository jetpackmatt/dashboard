// Font configuration for the dashboard application
import { Outfit, Roboto_Mono } from 'next/font/google'
import localFont from 'next/font/local'

// Google Fonts - Outfit (display/headings)
export const outfit = Outfit({
  subsets: ['latin'],
  weight: ['200', '300', '400', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
})

// Geist Sans (data tables, body text)
export const roboto = localFont({
  src: '../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2',
  variable: '--font-roboto',
  display: 'swap',
})

// Roboto Mono (monospaced - IDs, tracking numbers)
export const mono = Roboto_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

// Export font class names for use in layout
export const fontVariables = `${outfit.variable} ${roboto.variable} ${mono.variable}`
