import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // Force single react instance across bundled app code and externally-loaded
  // @react-pdf/* packages (fixes React #31 / "older version of React" in PDF gen).
  webpack: (config) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
    }
    return config
  },
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
