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
 *
 * This is the most security-sensitive file in the project. See SECURITY.md.
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
const STRIPPED_REQUEST_HEADERS = new Set([
  UPSTREAM_HEADER,
  API_KEY_HEADER,
  'cookie',
  'origin',
  'referer',
  // Fetch metadata is about the browser->lgview hop and means nothing upstream.
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
])

/**
 * Response headers we never relay. `set-cookie` is the important one: cookies
 * are scoped by host and ignore the port, so a cookie from an upstream would
 * be planted on 127.0.0.1 for every other dev server on the machine.
 */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-expose-headers',
  'content-security-policy',
  'content-security-policy-report-only',
  // Rewritten or dropped deliberately; see handleProxy.
  'location',
])

export class ProxyError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProxyError'
    this.status = status
  }
}

/** True when the request's Host header names a loopback address. */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  return isLoopbackHost(req.headers.host ?? '')
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

/**
 * Reject anything that is not a same-origin request from the page we served.
 *
 * The proxy forwards to any address the page names, so a website the user
 * happens to have open must never be able to drive it. Three checks, none of
 * which relies on the browser enforcing CORS for us:
 *
 *   - The `Host` must be a loopback name. Without this, DNS rebinding points an
 *     attacker-controlled hostname at 127.0.0.1 and sails through.
 *   - `Sec-Fetch-Site`, when the browser sends it, must say `same-origin`.
 *     This is the load-bearing one. `Origin` alone is not enough: browsers omit
 *     it entirely on `<img>`, `<script>` and `no-cors fetch()` GETs, so an
 *     Origin-only check waves through exactly the cross-site GETs an attacker
 *     can make for free -- and those GETs are enough to read every thread and
 *     checkpoint on the configured server.
 *   - `Origin`, when present, must be ours.
 *
 * Requests with no fetch metadata and no Origin at all (curl, the test suite,
 * another local process) are allowed through. That is deliberate: lgview binds
 * to loopback and treats local code execution as out of scope. See SECURITY.md.
 */
export function assertSameOrigin(req: IncomingMessage): void {
  const host = req.headers.host ?? ''
  if (!isLoopbackHost(host)) {
    throw new ProxyError(403, `refusing request with non-loopback Host header: ${host}`)
  }

  const fetchSite = header(req, 'sec-fetch-site')
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new ProxyError(403, `cross-site request rejected (Sec-Fetch-Site: ${fetchSite})`)
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

/**
 * The upstream is always named explicitly by the page. There is deliberately no
 * server-side default: a fallback would make the custom header optional, and a
 * request with no custom header is one the browser will send cross-site without
 * a preflight.
 */
export function resolveUpstream(req: IncomingMessage): URL {
  const raw = header(req, UPSTREAM_HEADER)
  if (!raw) {
    throw new ProxyError(400, `missing ${UPSTREAM_HEADER} header`)
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

/**
 * Decide whether an API key may be sent to this target.
 *
 * A key is issued by one server and is worthless to any other, so sending it
 * anywhere else is pure downside: one mistyped URL in the "manage servers" box
 * would hand a tenant-wide LangGraph Platform key to a stranger. A key is
 * therefore only ever attached to the exact origin it was configured for, and
 * never over plaintext http to a non-loopback host.
 */
export function maySendApiKey(target: URL, boundOrigin: string | undefined): boolean {
  if (target.protocol === 'http:' && !isLoopbackHost(target.host)) return false
  if (!boundOrigin) return true
  try {
    return new URL(boundOrigin).origin === target.origin
  } catch {
    return false
  }
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
  /** The `--server` the CLI was started with, used to scope `defaultApiKey`. */
  defaultUpstream?: string
  /** `--api-key`. Only ever sent to `defaultUpstream`. */
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
    const upstream = resolveUpstream(req)
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

    // A key sent by the page belongs to the server the page named, so it is
    // bound to that upstream. The CLI's key is bound to the CLI's `--server`.
    const pageKey = header(req, API_KEY_HEADER)
    const apiKey = pageKey ?? options.defaultApiKey
    const boundOrigin = pageKey ? upstream.origin : options.defaultUpstream
    if (apiKey && maySendApiKey(target, boundOrigin)) {
      headers.set('x-api-key', apiKey)
    }

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
      const lower = key.toLowerCase()
      if (HOP_BY_HOP.has(lower) || STRIPPED_RESPONSE_HEADERS.has(lower)) return
      outHeaders[key] = value
    })

    // The upstream chooses this Content-Type, and an upstream serving HTML
    // would otherwise get to execute script on the lgview origin -- where every
    // configured server's API key is sitting in localStorage.
    outHeaders['x-content-type-options'] = 'nosniff'
    outHeaders['cache-control'] = 'no-store'

    // A redirect carries the browser somewhere of the upstream's choosing,
    // without the key we attach server-side, and possibly to another origin.
    // Same-origin hops are rewritten back through the proxy; anything else is
    // refused rather than followed.
    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      const location = upstreamResponse.headers.get('location')
      const rewritten = location ? rewriteLocation(location, target, upstream) : null
      if (!rewritten) {
        throw new ProxyError(
          502,
          `upstream redirected to a different origin (${location ?? 'no Location header'}); refusing to follow`,
        )
      }
      outHeaders['location'] = rewritten
    }

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
      res.writeHead(status, { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' })
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
 * Map an upstream redirect back onto our own origin, or return null if it
 * leaves the upstream entirely.
 */
export function rewriteLocation(location: string, target: URL, upstream: URL): string | null {
  let resolved: URL
  try {
    resolved = new URL(location, target)
  } catch {
    return null
  }
  if (resolved.origin !== upstream.origin) return null
  const basePath = upstream.pathname.replace(/\/+$/, '')
  const path = resolved.pathname.startsWith(basePath) ? resolved.pathname.slice(basePath.length) : resolved.pathname
  return `${PROXY_PREFIX}${path || '/'}${resolved.search}`
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
        // A destroyed socket never emits 'drain', so waiting on it alone hangs
        // this handler forever on the ordinary cancel-a-run path.
        await waitForDrain(res)
        if (res.destroyed || res.writableEnded) return
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

function waitForDrain(res: ServerResponse): Promise<void> {
  if (res.destroyed || res.writableEnded) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done)
      res.off('close', done)
      res.off('error', done)
      resolve()
    }
    res.once('drain', done)
    res.once('close', done)
    res.once('error', done)
  })
}
