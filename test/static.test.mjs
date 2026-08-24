import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveStatic } from '../cli/static.ts'

let server
let base
let root

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'lgview-static-'))
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>shell</title>')
  await writeFile(join(root, 'assets', 'app-abc123.js'), 'console.log(1)')
  await writeFile(join(root, '..', 'secret.txt'), 'do not serve me')

  server = createServer((req, res) => void serveStatic(req, res, root))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server?.close())

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

test('path traversal cannot escape the web root', async () => {
  for (const path of ['/../secret.txt', '/%2e%2e%2fsecret.txt', '/assets/../../secret.txt']) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' })
    assert.equal(res.status, 404, `${path} should not be served`)
  }
})
