// Font configuration for the dashboard application
import { Outfit } from 'next/font/google'

// Google Fonts - Outfit (always available)
export const outfit = Outfit({
  subsets: ['latin'],
  weight: ['200', '300', '400', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
})

// Note: THICCCBOI font configuration is preserved in tailwind.config.ts
// for future use, but not loaded here to avoid build errors

// Export font class names for use in layout
export const fontVariables = outfit.variable
