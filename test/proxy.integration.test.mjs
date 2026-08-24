import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { handleProxy } from '../cli/proxy.ts'

let upstream
let upstreamUrl
let proxy
let proxyUrl
/** Requests the fake LangGraph server saw, for asserting on what we forward. */
const seen = []

before(async () => {
  upstream = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, headers: req.headers })

    if (req.url === '/runs/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: metadata\ndata: {"run_id":"r1"}\n\n')
      setTimeout(() => {
        res.write('event: updates\ndata: {"plan":{"ok":true}}\n\n')
        res.end()
      }, 20)
      return
    }
    if (req.url === '/echo') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ received: body }))
      })
      return
    }
    if (req.url === '/api/nested/ok') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"nested":true}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end('{"ok":true}')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`

  proxy = createServer((req, res) => {
    void handleProxy(req, res, { defaultUpstream: upstreamUrl }).then((handled) => {
      if (!handled) {
        res.writeHead(404)
        res.end('not proxied')
      }
    })
  })
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  proxyUrl = `http://127.0.0.1:${proxy.address().port}`
})

after(() => {
  proxy?.close()
  upstream?.close()
})

const lg = (path, init) => fetch(`${proxyUrl}/__lg${path}`, init)

test('forwards a GET and returns the upstream body', async () => {
  const res = await lg('/ok')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('leaves non-proxy paths alone', async () => {
  const res = await fetch(`${proxyUrl}/index.html`)
  assert.equal(res.status, 404)
  assert.equal(await res.text(), 'not proxied')
})

test('forwards a POST body', async () => {
  const res = await lg('/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit: 5 }),
  })
  assert.deepEqual(await res.json(), { received: '{"limit":5}' })
})

test('injects the api key and hides lgview control headers from upstream', async () => {
  seen.length = 0
  await lg('/ok', { headers: { 'x-lgview-api-key': 'sk-test', cookie: 'session=nope' } })
  const request = seen.at(-1)
  assert.equal(request.headers['x-api-key'], 'sk-test')
  assert.equal(request.headers['x-lgview-api-key'], undefined)
  assert.equal(request.headers['x-lgview-upstream'], undefined)
  assert.equal(request.headers.cookie, undefined)
})

test('does not relay the upstream CORS headers', async () => {
  const res = await lg('/ok')
  assert.equal(res.headers.get('access-control-allow-origin'), null)
})

test('honours a per-request upstream with a base path', async () => {
  const res = await lg('/nested/ok', { headers: { 'x-lgview-upstream': `${upstreamUrl}/api` } })
  assert.deepEqual(await res.json(), { nested: true })
})

test('streams SSE through without buffering it into one chunk', async () => {
  const res = await lg('/runs/stream', { method: 'POST', headers: { accept: 'text/event-stream' } })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  const first = decoder.decode((await reader.read()).value)
  assert.match(first, /event: metadata/)
  // The second frame is written 20ms later; receiving it separately proves the
  // response was not held open and flushed at the end.
  assert.doesNotMatch(first, /event: updates/)

  let rest = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    rest += decoder.decode(value, { stream: true })
  }
  assert.match(rest, /event: updates/)
})

test('a dead upstream becomes a 502 that names the real reason', async () => {
  // A closed high port, not a reserved one: fetch rejects ports like 1 with
  // "bad port" before it ever tries to connect.
  const res = await lg('/ok', { headers: { 'x-lgview-upstream': 'http://127.0.0.1:45999' } })
  assert.equal(res.status, 502)
  const body = await res.json()
  assert.equal(body.error, 'lgview_proxy_error')
  assert.ok(body.target.startsWith('http://127.0.0.1:45999/'))
  // "fetch failed" tells a user nothing; the nested errno has to survive.
  assert.match(body.message, /nothing is listening on http:\/\/127\.0\.0\.1:45999/)
})

test('an unresolvable host is reported as a name-resolution failure', async () => {
  const res = await lg('/ok', {
    headers: { 'x-lgview-upstream': 'http://lgview-nonexistent.invalid' },
  })
  assert.equal(res.status, 502)
  assert.match((await res.json()).message, /could not resolve/)
})

test('an unusable upstream url is a 400, not a crash', async () => {
  const res = await lg('/ok', { headers: { 'x-lgview-upstream': 'not a url' } })
  assert.equal(res.status, 400)
})
