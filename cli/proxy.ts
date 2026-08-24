/**
 * Reverse proxy from the lgview UI to whatever LangGraph server the user picked.
 *
 * The browser never talks to the LangGraph server directly. Everything goes
 * through `/__lg/*` on our own origin, with the upstream base URL carried in a
 * request header. That buys three things:
 *
 *   1. CORS stops mattering. `langgraph dev` happens to allow any origin today,
 *      but a self-hosted or Platform deployment may not, and we want the same
 *      code path for all of them.
 *   2. API keys are attached server-side, so switching between a local dev
 *      server and a deployed one is a one-field change in the UI.
 *   3. Dev and production behave identically -- the Vite dev server mounts this
 *      exact handler as middleware.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export const PROXY_PREFIX = '/__lg'
export const UPSTREAM_HEADER = 'x-lgview-upstream'
export const API_KEY_HEADER = 'x-lgview-api-key'

/** Headers that describe a single hop and must not be forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

/** Request headers we refuse to relay upstream, on top of the hop-by-hop set. */
const STRIPPED_REQUEST_HEADERS = new Set([UPSTREAM_HEADER, API_KEY_HEADER, 'cookie', 'origin', 'referer'])

export class ProxyError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProxyError'
    this.status = status
  }
}

/**
 * This proxy will forward to any address the page asks for, so it must only
 * ever be reachable by the page we served. A website the user happens to have
 * open must not be able to use it as a confused deputy against their intranet.
 *
 * Two checks do that. Both are cheap and neither depends on the browser
 * enforcing CORS for us:
 *   - The Host header must be a loopback name. Without this, a DNS rebinding
 *     attack can point an attacker-controlled hostname at 127.0.0.1.
 *   - If an Origin is present it must be our own. Cross-origin fetches that
 *     carry our custom header are preflighted, and we deliberately answer no
 *     CORS headers at all, so this is belt and braces.
 */
export function assertSameOrigin(req: IncomingMessage): void {
  const host = req.headers.host ?? ''
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  if (!loopback) {
    throw new ProxyError(403, `refusing request with non-loopback Host header: ${host}`)
  }
  const origin = req.headers.origin
  if (origin) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      throw new ProxyError(403, `malformed Origin header: ${origin}`)
    }
    if (originHost !== host) {
      throw new ProxyError(403, `cross-origin request rejected (origin ${origin}, host ${host})`)
    }
  }
}

export function resolveUpstream(req: IncomingMessage, fallback?: string): URL {
  const raw = header(req, UPSTREAM_HEADER) ?? fallback
  if (!raw) {
    throw new ProxyError(400, `missing ${UPSTREAM_HEADER} header and no default server configured`)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ProxyError(400, `not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError(400, `unsupported protocol: ${url.protocol}`)
  }
  return url
}

/**
 * Join the upstream base with the sub-path, preserving any base path.
 * A server mounted at `https://example.com/api` must see `/api/threads`,
 * not `/threads`.
 */
export function buildTargetUrl(upstream: URL, requestUrl: string): URL {
  const [pathname, search = ''] = splitQuery(requestUrl.slice(PROXY_PREFIX.length) || '/')
  const basePath = upstream.pathname.replace(/\/+$/, '')
  const target = new URL(upstream.toString())
  target.pathname = basePath + (pathname.startsWith('/') ? pathname : `/${pathname}`)
  target.search = search
  return target
}

function splitQuery(url: string): [string, string] {
  const i = url.indexOf('?')
  return i === -1 ? [url, ''] : [url.slice(0, i), url.slice(i)]
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

export interface ProxyOptions {
  /** Used when the page does not name an upstream (e.g. the very first load). */
  defaultUpstream?: string
  /** Fallback API key from the CLI, overridden per-request by the UI. */
  defaultApiKey?: string
  onError?: (err: unknown, target?: string) => void
}

/**
 * Handle a `/__lg/*` request. Returns false if the request is not ours, so the
 * caller can fall through to static file serving.
 */
export async function handleProxy(
  req: IncomingMessage,
  res: ServerResponse,
  options: ProxyOptions = {},
): Promise<boolean> {
  const url = req.url ?? '/'
  if (url !== PROXY_PREFIX && !url.startsWith(`${PROXY_PREFIX}/`)) return false

  let target: URL | undefined
  try {
    assertSameOrigin(req)
    const upstream = resolveUpstream(req, options.defaultUpstream)
    target = buildTargetUrl(upstream, url)

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      const lower = key.toLowerCase()
      if (HOP_BY_HOP.has(lower) || STRIPPED_REQUEST_HEADERS.has(lower)) continue
      headers.set(lower, Array.isArray(value) ? value.join(', ') : value)
    }
    // Compressed SSE would be buffered by some intermediaries; ask for plain bytes.
    headers.set('accept-encoding', 'identity')

    const apiKey = header(req, API_KEY_HEADER) ?? options.defaultApiKey
    if (apiKey) headers.set('x-api-key', apiKey)

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const controller = new AbortController()
    res.on('close', () => controller.abort())

    const upstreamResponse = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
      // Required by undici whenever a stream is used as the body.
      duplex: 'half',
      redirect: 'manual',
      signal: controller.signal,
    } as RequestInit & { duplex: 'half' })

    const outHeaders: Record<string, string> = {}
    upstreamResponse.headers.forEach((value, key) => {
      if (HOP_BY_HOP.has(key.toLowerCase())) return
      outHeaders[key] = value
    })
    // We serve no CORS headers of our own: same-origin only, by construction.
    delete outHeaders['access-control-allow-origin']
    delete outHeaders['access-control-allow-credentials']

    res.writeHead(upstreamResponse.status, outHeaders)
    // Streaming responses must reach the browser as they arrive, not on close.
    res.flushHeaders?.()

    if (upstreamResponse.body) {
      await pipeToResponse(upstreamResponse.body, res)
    } else {
      res.end()
    }
    return true
  } catch (err) {
    options.onError?.(err, target?.toString())
    if (!res.headersSent) {
      const status = err instanceof ProxyError ? err.status : 502
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'lgview_proxy_error',
          message: describeFailure(err, target),
          target: target?.toString(),
        }),
      )
    } else {
      res.end()
    }
    return true
  }
}

/**
 * Undici reports every connection failure as a bare "fetch failed", which tells
 * a user nothing. The real reason is on `cause.code`.
 */
function describeFailure(err: unknown, target?: URL): string {
  if (err instanceof ProxyError) return err.message
  const code = errorCode(err)
  const where = target ? `${target.protocol}//${target.host}` : 'the server'
  switch (code) {
    case 'ECONNREFUSED':
      return `nothing is listening on ${where}`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `could not resolve ${where}`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `timed out connecting to ${where}`
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return `the TLS certificate for ${where} was rejected (${code})`
    default:
      break
  }
  const message = err instanceof Error ? err.message : String(err)
  return code ? `${message} (${code}) reaching ${where}` : `${message} reaching ${where}`
}

/**
 * Dig the errno out of a fetch failure. Undici nests it under `cause`, and
 * when a host resolves to several addresses the cause is an AggregateError
 * holding one error per attempt.
 */
function errorCode(err: unknown, depth = 0): string | undefined {
  if (depth > 3 || typeof err !== 'object' || err === null) return undefined
  const candidate = err as { code?: string; cause?: unknown; errors?: unknown[] }
  if (typeof candidate.code === 'string' && candidate.code !== 'ERR_ASSERTION') return candidate.code
  if (Array.isArray(candidate.errors)) {
    for (const entry of candidate.errors) {
      const code = errorCode(entry, depth + 1)
      if (code) return code
    }
  }
  return errorCode(candidate.cause, depth + 1)
}

async function pipeToResponse(body: ReadableStream<Uint8Array>, res: ServerResponse): Promise<void> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once('drain', resolve))
      }
    }
    res.end()
  } catch {
    // Client hung up mid-stream, or upstream died. Either way, close cleanly.
    res.destroy()
  } finally {
    reader.releaseLock()
  }
}
