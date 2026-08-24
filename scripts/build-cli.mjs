/** Bundle the CLI into a single dependency-free ESM file. */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { chmod } from 'node:fs/promises'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['cli/index.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  define: { 'process.env.LGVIEW_VERSION': JSON.stringify(pkg.version) },
  logLevel: 'info',
})

// npm sets the bit for `bin` entries on install, but running `node dist/cli.js`
// or `./dist/cli.js` straight out of the repo should work too.
await chmod(new URL('../dist/cli.js', import.meta.url), 0o755)
