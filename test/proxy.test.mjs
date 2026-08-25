import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  assertSameOrigin,
  buildTargetUrl,
  isLoopbackRequest,
  maySendApiKey,
  resolveUpstream,
  rewriteLocation,
  ProxyError,
} from '../cli/proxy.ts'
import { normalizeServerUrl, parseCliArgs, DEFAULT_PORT } from '../cli/args.ts'

const req = (headers) => ({ headers })

// ── origin guards ───────────────────────────────────────────────────────────

test('accepts a loopback host with no origin', () => {
  assert.doesNotThrow(() => assertSameOrigin(req({ host: '127.0.0.1:4141' })))
  assert.doesNotThrow(() => assertSameOrigin(req({ host: 'localhost:4141' })))
})

test('accepts a matching origin', () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(req({ host: 'localhost:4141', origin: 'http://localhost:4141' })),
  )
})

test('rejects a cross-origin request', () => {
  assert.throws(
    () => assertSameOrigin(req({ host: 'localhost:4141', origin: 'https://evil.example' })),
    ProxyError,
  )
})

test('rejects a rebound non-loopback host', () => {
  assert.throws(() => assertSameOrigin(req({ host: 'attacker.example' })), ProxyError)
  assert.equal(isLoopbackRequest(req({ host: 'attacker.example' })), false)
  assert.equal(isLoopbackRequest(req({ host: '127.0.0.1:4141' })), true)
})

/**
 * The one that matters. Browsers omit `Origin` on <img>, <script> and no-cors
 * fetch() GETs, so an Origin-only check waves through exactly the cross-site
 * GETs an attacker gets for free -- and those are enough to read every thread
 * and checkpoint on the configured server.
 */
test('rejects a cross-site GET that carries no Origin at all', () => {
  assert.throws(
    () => assertSameOrigin(req({ host: 'localhost:4141', 'sec-fetch-site': 'cross-site' })),
    /Sec-Fetch-Site/,
  )
  assert.throws(
    () => assertSameOrigin(req({ host: 'localhost:4141', 'sec-fetch-site': 'same-site' })),
    /Sec-Fetch-Site/,
  )
})

test('accepts same-origin fetch metadata', () => {
  assert.doesNotThrow(() =>
    assertSameOrigin(req({ host: 'localhost:4141', 'sec-fetch-site': 'same-origin' })),
  )
  // A typed-in URL or a bookmark reports `none`; that is the user, not a site.
  assert.doesNotThrow(() => assertSameOrigin(req({ host: 'localhost:4141', 'sec-fetch-site': 'none' })))
})

// ── upstream resolution ─────────────────────────────────────────────────────

test('requires the upstream header, with no server-side fallback', () => {
  assert.equal(resolveUpstream(req({ 'x-lgview-upstream': 'http://a:1' })).toString(), 'http://a:1/')
  // A fallback would make the custom header optional, and a request without a
  // custom header is one a browser will send cross-site with no preflight.
  assert.throws(() => resolveUpstream(req({})), /missing x-lgview-upstream/)
})

test('rejects non-http upstream protocols', () => {
  assert.throws(() => resolveUpstream(req({ 'x-lgview-upstream': 'file:///etc/passwd' })), ProxyError)
  assert.throws(() => resolveUpstream(req({ 'x-lgview-upstream': 'not a url' })), ProxyError)
})

test('preserves a base path on the upstream', () => {
  const target = buildTargetUrl(new URL('https://example.com/api/'), '/__lg/threads/abc/state?subgraphs=true')
  assert.equal(target.toString(), 'https://example.com/api/threads/abc/state?subgraphs=true')
})

test('maps a bare upstream root onto the request path', () => {
  const target = buildTargetUrl(new URL('http://127.0.0.1:2024'), '/__lg/assistants/search')
  assert.equal(target.toString(), 'http://127.0.0.1:2024/assistants/search')
})

// ── api key binding ─────────────────────────────────────────────────────────

test('an api key only goes to the origin it was configured for', () => {
  const bound = 'https://deploy.example.com'
  assert.equal(maySendApiKey(new URL('https://deploy.example.com/threads'), bound), true)
  // One mistyped URL in the manage-servers box must not leak a tenant key.
  assert.equal(maySendApiKey(new URL('https://depoly.example.com/threads'), bound), false)
  assert.equal(maySendApiKey(new URL('https://deploy.example.com.evil.test/'), bound), false)
})

test('an api key is never sent over plaintext http off-loopback', () => {
  assert.equal(maySendApiKey(new URL('http://deploy.example.com/x'), 'http://deploy.example.com'), false)
  // Loopback http is the normal `langgraph dev` case and stays allowed.
  assert.equal(maySendApiKey(new URL('http://127.0.0.1:2024/x'), 'http://127.0.0.1:2024'), true)
  assert.equal(maySendApiKey(new URL('http://localhost:2024/x'), 'http://localhost:2024'), true)
})

test('an unparseable bound origin denies rather than defaults open', () => {
  assert.equal(maySendApiKey(new URL('https://any.example/x'), 'not a url'), false)
})

// ── redirects ───────────────────────────────────────────────────────────────

test('a same-origin redirect is rewritten back through the proxy', () => {
  const upstream = new URL('http://127.0.0.1:2024')
  const target = new URL('http://127.0.0.1:2024/threads')
  assert.equal(rewriteLocation('/threads/', target, upstream), '/__lg/threads/')
  assert.equal(rewriteLocation('http://127.0.0.1:2024/ok?x=1', target, upstream), '/__lg/ok?x=1')
})

test('a cross-origin redirect is refused, not followed', () => {
  const upstream = new URL('http://127.0.0.1:2024')
  const target = new URL('http://127.0.0.1:2024/threads')
  // Following this would send the browser off-origin without the key we attach
  // server-side, and onto a host the user never configured.
  assert.equal(rewriteLocation('https://evil.example/steal', target, upstream), null)
})

test('a redirect under a based upstream keeps the base path off the proxy path', () => {
  const upstream = new URL('https://example.com/api')
  const target = new URL('https://example.com/api/threads')
  assert.equal(rewriteLocation('https://example.com/api/threads/1', target, upstream), '/__lg/threads/1')
})

// ── cli ─────────────────────────────────────────────────────────────────────

test('normalizes server urls typed without a scheme', () => {
  assert.equal(normalizeServerUrl('localhost:2024'), 'http://localhost:2024')
  assert.equal(normalizeServerUrl('http://localhost:2024/'), 'http://localhost:2024')
  assert.equal(normalizeServerUrl('https://deploy.example.com/api/'), 'https://deploy.example.com/api')
})

test('parses cli flags', () => {
  assert.deepEqual(parseCliArgs(['--server', 'localhost:9000', '--port', '5000', '--no-open']), {
    server: 'http://localhost:9000',
    port: 5000,
    apiKey: undefined,
    open: false,
  })
})

test('defaults are applied when no flags are given', () => {
  const parsed = parseCliArgs([])
  assert.equal(parsed.port, DEFAULT_PORT)
  assert.equal(parsed.server, 'http://127.0.0.1:2024')
  // Opening a browser is the default; only --no-open turns it off.
  assert.equal(parsed.open, true)
})

test('rejects a port outside the valid range', () => {
  assert.throws(() => parseCliArgs(['--port', 'nope']), /--port/)
  assert.throws(() => parseCliArgs(['--port', '-1']), /--port/)
  assert.throws(() => parseCliArgs(['--port', '65536']), /--port/)
  assert.throws(() => parseCliArgs(['--port', '3.5']), /--port/)
  // The boundaries themselves are valid.
  assert.equal(parseCliArgs(['--port', '65535']).port, 65535)
  assert.equal(parseCliArgs(['--port', '0']).port, 0)
})

test('--host is gone; lgview is loopback-only by construction', () => {
  assert.throws(() => parseCliArgs(['--host', '0.0.0.0']), /Unknown option/)
})

test('help and version short-circuit parsing', () => {
  assert.deepEqual(parseCliArgs(['--help']), { help: true })
  assert.deepEqual(parseCliArgs(['-v']), { version: true })
})
