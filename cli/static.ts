/** Minimal static file server for the built single-page app. */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  const requested = decodeURIComponent((req.url ?? '/').split('?')[0])
  const filePath = await resolveFile(root, requested)

  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  const ext = extname(filePath)
  const headers: Record<string, string> = {
    'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
  }
  // Vite fingerprints everything under /assets/, so those are safe to cache hard.
  // index.html must never be cached or a stale shell survives an upgrade.
  headers['cache-control'] = filePath.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  // The page holds API keys in localStorage; never let it be framed, and never
  // let a mistyped content type be re-sniffed into something executable.
  headers['x-content-type-options'] = 'nosniff'
  headers['x-frame-options'] = 'DENY'
  headers['content-security-policy'] = "frame-ancestors 'none'"

  res.writeHead(200, headers)
  createReadStream(filePath).pipe(res)
}

async function resolveFile(root: string, requested: string): Promise<string | null> {
  // A bare `startsWith(root)` is not containment: with a root of `/a/web`, the
  // path `/a/web-private/secret` passes it. Comparing against `root + sep`
  // (and allowing the root itself) is the actual check.
  const base = resolve(root)
  const candidate = normalize(join(base, requested))
  if (candidate !== base && !candidate.startsWith(base + sep)) return null

  const direct = await statOrNull(candidate)
  if (direct?.isFile()) return candidate
  if (direct?.isDirectory()) {
    const index = join(candidate, 'index.html')
    if ((await statOrNull(index))?.isFile()) return index
  }

  // Single-page app: unknown paths render the shell and the router takes over.
  // Asset requests are exempt, so a missing bundle 404s instead of silently
  // returning HTML with a JavaScript content type.
  if (!requested.startsWith('/assets/') && !extname(requested)) {
    const shell = join(root, 'index.html')
    if ((await statOrNull(shell))?.isFile()) return shell
  }
  return null
}

async function statOrNull(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}
