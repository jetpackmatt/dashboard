import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable StrictMode in dev — it double-fires every useEffect, doubling all API fetches
  // on a single-threaded dev server. This only affects dev; production is unaffected.
  reactStrictMode: false,

  // Use Turbopack for faster dev builds and HMR
  turbopack: {
    // Exclude large directories from file watching to reduce CPU
    rules: {
      '*.md': ['raw-loader'],
    },
  },

  // Mark packages as external to prevent webpack from bundling them
  // - ssh2/ssh2-sftp-client: Use optional native crypto bindings that break webpack
  // - @react-pdf/*: Uses custom React reconciler that conflicts with Next.js bundling
  // Include the prebuilt PDF worker and its runtime assets in the serverless
  // function bundles for any route that generates invoice PDFs.
  outputFileTracingIncludes: {
    '/api/admin/invoices/generate': [
      './pdf-worker.cjs',
      './public/fonts/outfit/**',
      './public/images/jetpack-logo.png',
    ],
    '/api/admin/invoices/[invoiceId]/regenerate': [
      './pdf-worker.cjs',
      './public/fonts/outfit/**',
      './public/images/jetpack-logo.png',
    ],
    '/api/cron/generate-invoices': [
      './pdf-worker.cjs',
      './public/fonts/outfit/**',
      './public/images/jetpack-logo.png',
    ],
    '/api/cron/refresh-demo': [
      './pdf-worker.cjs',
      './public/fonts/outfit/**',
      './public/images/jetpack-logo.png',
    ],
  },

  serverExternalPackages: [
    'ssh2',
    'ssh2-sftp-client',
    '@react-pdf/renderer',
    '@react-pdf/reconciler',
    '@react-pdf/primitives',
    '@react-pdf/layout',
    '@react-pdf/fns',
    '@react-pdf/font',
    '@react-pdf/image',
    '@react-pdf/pdfkit',
    '@react-pdf/png-js',
    '@react-pdf/render',
    '@react-pdf/stylesheet',
    '@react-pdf/textkit',
    '@react-pdf/types',
  ],
}

export default nextConfig
