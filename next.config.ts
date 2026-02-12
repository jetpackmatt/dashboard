import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
