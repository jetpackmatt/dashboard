// Bundles the PDF worker + generator into a single standalone CJS file
// so the serverless function can spawn `node pdf-worker.cjs` without tsx,
// fully isolating @react-pdf's React from Next.js's bundled React.
import { build } from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

await build({
  entryPoints: [path.join(root, 'scripts/generate-pdf-worker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(root, 'pdf-worker.cjs'),
  external: [],
  loader: { '.ts': 'ts', '.tsx': 'tsx' },
  jsx: 'automatic',
  logLevel: 'info',
})

console.log('pdf-worker.cjs built')
