# Quick Guide: Adding Thiccboi Fonts

This is a quick reference guide for integrating Thiccboi fonts after you obtain the font files.

## Step 1: Add Font Files

Place these files in `/public/fonts/`:

```
/public/fonts/
├── Thiccboi-Light.woff2      (Weight 300)
├── Thiccboi-Regular.woff2    (Weight 400)
├── Thiccboi-Medium.woff2     (Weight 500)
├── Thiccboi-SemiBold.woff2   (Weight 600)
└── Thiccboi-Bold.woff2       (Weight 700)
```

## Step 2: Update `/app/fonts.ts`

Replace the entire file contents with:

```typescript
// Font configuration for the dashboard application
import { Outfit } from 'next/font/google'
import localFont from 'next/font/local'

// Google Fonts - Outfit (always available)
export const outfit = Outfit({
  subsets: ['latin'],
  weight: ['200', '300', '400'],
  variable: '--font-outfit',
  display: 'swap',
})

// Local Font - Thiccboi
export const thiccboi = localFont({
  src: [
    {
      path: '../public/fonts/Thiccboi-Light.woff2',
      weight: '300',
      style: 'normal',
    },
    {
      path: '../public/fonts/Thiccboi-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/Thiccboi-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../public/fonts/Thiccboi-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../public/fonts/Thiccboi-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-thiccboi',
  display: 'swap',
})

// Export font class names for use in layout
export const fontVariables = `${outfit.variable} ${thiccboi.variable}`
```

## Step 3: Update `/app/layout.tsx`

Change the import line:

```typescript
import { outfit, thiccboi, fontVariables } from './fonts'
```

The rest of the file stays the same.

## Step 4: Update `/tailwind.config.ts`

Find the `fontFamily` section and update the `display` line:

```typescript
fontFamily: {
  // Headers - Thiccboi with Outfit fallback
  display: ['var(--font-thiccboi)', 'var(--font-outfit)', 'system-ui', 'sans-serif'],
  // Body text - Outfit 300
  body: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
  // Outfit font family
  outfit: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
},
```

## Step 5: Test

```bash
# Development
npm run dev

# Production build
npm run build
npm start
```

## Verification Checklist

- [ ] All 5 Thiccboi font files are in `/public/fonts/`
- [ ] `/app/fonts.ts` updated with Thiccboi configuration
- [ ] `/app/layout.tsx` imports updated
- [ ] `/tailwind.config.ts` display font family updated
- [ ] `npm run build` completes without errors
- [ ] Headers display in Thiccboi font in the browser
- [ ] Body text still displays in Outfit font

## Rollback

If you need to revert back to Outfit-only:

1. Restore `/app/fonts.ts` to remove Thiccboi import and export
2. Restore `/app/layout.tsx` import
3. Restore `/tailwind.config.ts` display font family to just use `var(--font-outfit)`

## Need Help?

See the full documentation in:
- `/public/fonts/README.md` - Detailed font information
- `/FONT_INTEGRATION_SUMMARY.md` - Complete implementation details
