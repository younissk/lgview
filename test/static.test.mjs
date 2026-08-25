import { test, beforeAll, afterAll } from 'vitest'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveStatic } from '../cli/static.ts'

let server
let base
let root

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lgview-static-'))
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>shell</title>')
  await writeFile(join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
  await writeFile(join(root, '..', 'secret.txt'), 'do not serve me')
  // A sibling whose name merely *starts with* the web root's name. This is what
  // a bare `startsWith(root)` containment check lets through.
  await mkdir(`${root}-private`, { recursive: true })
  await writeFile(join(`${root}-private`, 'secret.txt'), 'LEAKED-SIBLING-PREFIX')

  server = createServer((req, res) => void serveStatic(req, res, root))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => server?.close())

test('serves the shell at the root', async () => {
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  assert.equal(res.headers.get('cache-control'), 'no-cache')
})

test('fingerprinted assets are cached hard and typed correctly', async () => {
  const res = await fetch(`${base}/assets/app-abc123.js`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /javascript/)
  assert.match(res.headers.get('cache-control'), /immutable/)
})

test('an unknown route falls back to the shell so the app can route it', async () => {
  const res = await fetch(`${base}/threads/some-id`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /shell/)
})

test('a missing asset 404s rather than returning HTML as JavaScript', async () => {
  const res = await fetch(`${base}/assets/missing.js`)
  assert.equal(res.status, 404)
})

/**
 * `fetch` normalises `..` out of a URL before the request is ever sent, so a
 * fetch-based traversal test cannot reach the server with a dotted path at all
 * -- it passes whether or not the guard exists. These go down a raw socket.
 */
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`)
    })
    let raw = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (raw += chunk))
    socket.on('end', () => resolve(raw))
    socket.on('error', reject)
  })
}

test('path traversal cannot escape the web root', async () => {
  const { port } = server.address()
  const paths = [
    '/../secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/assets/../../secret.txt',
    '/..%2fsecret.txt',
    '/....//secret.txt',
  ]
  for (const path of paths) {
    const raw = await rawGet(port, path)
    assert.match(raw, /^HTTP\/1\.1 404/, `${path} should 404`)
    assert.doesNotMatch(raw, /do not serve me/, `${path} leaked the file`)
  }
})

test('a sibling directory sharing the root name prefix is not reachable', async () => {
  const { port } = server.address()
  // Root is `<tmp>/lgview-static-x`; this reaches for `<tmp>/lgview-static-x-private`.
  const raw = await rawGet(port, '/../' + root.split('/').pop() + '-private/secret.txt')
  assert.match(raw, /^HTTP\/1\.1 404/)
  assert.doesNotMatch(raw, /LEAKED-SIBLING-PREFIX/)
})

test('the shell is served with anti-framing and anti-sniffing headers', async () => {
  const res = await fetch(`${base}/`)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/)
})

test('a non-asset path that has an extension still 404s rather than serving the shell', async () => {
  // Pins the `/assets/` guard specifically: `extname` alone would also reject
  // this, so it is paired with the asset case above to kill both mutants.
  const res = await fetch(`${base}/deep/nested/thing.js`)
  assert.equal(res.status, 404)
})
