import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertSameOrigin, buildTargetUrl, resolveUpstream, ProxyError } from '../cli/proxy.ts'
import { normalizeServerUrl, parseCliArgs } from '../cli/args.ts'

const req = (headers) => ({ headers })

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
})

test('resolves the upstream from the header, falling back to the default', () => {
  assert.equal(resolveUpstream(req({ 'x-lgview-upstream': 'http://a:1' })).toString(), 'http://a:1/')
  assert.equal(resolveUpstream(req({}), 'http://b:2').toString(), 'http://b:2/')
  assert.throws(() => resolveUpstream(req({})), ProxyError)
  assert.throws(() => resolveUpstream(req({ 'x-lgview-upstream': 'file:///etc/passwd' })), ProxyError)
})

test('preserves a base path on the upstream', () => {
  const target = buildTargetUrl(new URL('https://example.com/api/'), '/__lg/threads/abc/state?subgraphs=true')
  assert.equal(target.toString(), 'https://example.com/api/threads/abc/state?subgraphs=true')
})

test('maps a bare upstream root onto the request path', () => {
  const target = buildTargetUrl(new URL('http://127.0.0.1:2024'), '/__lg/assistants/search')
  assert.equal(target.toString(), 'http://127.0.0.1:2024/assistants/search')
})

test('normalizes server urls typed without a scheme', () => {
  assert.equal(normalizeServerUrl('localhost:2024'), 'http://localhost:2024')
  assert.equal(normalizeServerUrl('http://localhost:2024/'), 'http://localhost:2024')
  assert.equal(normalizeServerUrl('https://deploy.example.com/api/'), 'https://deploy.example.com/api')
})

test('parses cli flags', () => {
  const parsed = parseCliArgs(['--server', 'localhost:9000', '--port', '5000', '--no-open'])
  assert.deepEqual(parsed, {
    server: 'http://localhost:9000',
    port: 5000,
    host: '127.0.0.1',
    apiKey: undefined,
    open: false,
  })
})

test('rejects a nonsense port', () => {
  assert.throws(() => parseCliArgs(['--port', 'nope']), /--port/)
})
