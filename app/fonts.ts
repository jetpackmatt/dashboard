// Font configuration for the dashboard application
import { Outfit, Inter } from 'next/font/google'

// Google Fonts - Outfit (display/headings)
export const outfit = Outfit({
  subsets: ['latin'],
  weight: ['200', '300', '400', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
})

// Google Fonts - Inter (data tables, body text)
export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// Export font class names for use in layout
export const fontVariables = `${outfit.variable} ${inter.variable}`
