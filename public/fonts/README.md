# Fonts Directory

This directory contains custom font files for the dashboard application.

## Required Font Files

### Thiccboi Font
To enable the Thiccboi font for headers, add the following font files to this directory:

- `Thiccboi-Light.woff2` (Weight 300)
- `Thiccboi-Regular.woff2` (Weight 400)
- `Thiccboi-Medium.woff2` (Weight 500)
- `Thiccboi-SemiBold.woff2` (Weight 600)
- `Thiccboi-Bold.woff2` (Weight 700)

**File Format:** The preferred format is `.woff2` for optimal web performance and Next.js font optimization.

## Current Font Setup

### Active Fonts
- **Outfit** (Google Fonts): Weights 200, 300, 400
  - Used for ALL text currently
  - Weight 300 is used for body text via `font-light` class
  - Weights 200-400 available for headers via `font-display` class

### Thiccboi Integration (Pending Font Files)
Once you add the Thiccboi font files above, follow these steps:

1. **Update app/fonts.ts:**
   - Import `localFont` from 'next/font/local'
   - Configure the Thiccboi font with the files above
   - Export the Thiccboi variable

2. **Update app/layout.tsx:**
   - Include the Thiccboi variable in the fontVariables export

3. **Update tailwind.config.ts:**
   - Modify the `display` font family to: `['var(--font-thiccboi)', 'var(--font-outfit)', 'system-ui', 'sans-serif']`

## Font Usage in Components

- **Headers (h1, h2, h3)**: Use `font-display` class - will automatically use Thiccboi when available
- **Body text**: Use `font-light` class - uses Outfit 300
- **UI elements**: Use default font or `font-body` class - uses Outfit regular

## Example Component Usage

```tsx
// Large header with display font
<h1 className="text-3xl font-display font-bold">Welcome</h1>

// Body text with light weight
<p className="text-sm font-light text-gray-500">Description text</p>

// Small header
<h2 className="text-xl font-display font-bold">Section Title</h2>
```
