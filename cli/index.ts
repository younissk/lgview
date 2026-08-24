/**
 * lgview -- a local web UI for any LangGraph server.
 *
 * Serves the built single-page app and reverse-proxies its API calls to the
 * LangGraph server you point it at. Nothing leaves your machine.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEFAULT_PORT, DEFAULT_SERVER, parseCliArgs, type Options } from './args.ts'
import { handleProxy } from './proxy.ts'
import { serveStatic } from './static.ts'

const VERSION = process.env.LGVIEW_VERSION ?? '0.1.0'

const HELP = `
  lgview ${VERSION} -- a local web UI for any LangGraph server

  Usage
    $ npx lgview [options]

  Options
    -s, --server <url>   LangGraph server to connect to  (default ${DEFAULT_SERVER})
    -p, --port <n>       Port to serve the UI on         (default ${DEFAULT_PORT})
        --host <host>    Interface to bind               (default 127.0.0.1)
        --api-key <key>  Sent upstream as x-api-key, for deployed servers
        --no-open        Do not open a browser
    -v, --version        Print version
    -h, --help           Show this help

  Examples
    $ langgraph dev                  # in your agent project, then:
    $ npx lgview                     # opens http://localhost:4141
    $ npx lgview -s http://localhost:8123
`


async function main(): Promise<void> {
  let options: Options
  try {
    const parsed = parseCliArgs(process.argv.slice(2))
    if ('help' in parsed) {
      console.log(HELP)
      return
    }
    if ('version' in parsed) {
      console.log(VERSION)
      return
    }
    options = parsed
  } catch (err) {
    console.error(`lgview: ${err instanceof Error ? err.message : String(err)}`)
    console.error('Run `lgview --help` for usage.')
    process.exitCode = 1
    return
  }

  const webRoot = join(dirname(fileURLToPath(import.meta.url)), 'web')

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.url === '/__lgview/config') {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ defaultServer: options.server, version: VERSION, hasApiKey: Boolean(options.apiKey) }))
          return
        }
        if (await handleProxy(req, res, {
          defaultUpstream: options.server,
          defaultApiKey: options.apiKey,
          onError: (err, target) => {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`lgview: proxy error${target ? ` for ${target}` : ''}: ${message}`)
          },
        })) return
        await serveStatic(req, res, webRoot)
      } catch (err) {
        console.error('lgview: request failed:', err)
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('Internal error')
      }
    })()
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`lgview: port ${options.port} is already in use. Try \`lgview --port ${options.port + 1}\`.`)
      process.exitCode = 1
      return
    }
    throw err
  })

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve))
  const { port } = server.address() as AddressInfo
  const uiUrl = `http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${port}`

  console.log('')
  console.log(`  lgview ${VERSION}`)
  console.log(`  UI          ${uiUrl}`)
  console.log(`  LangGraph   ${options.server}`)
  console.log('')
  await reportUpstreamHealth(options.server)
  console.log('  Ctrl-C to stop.')
  console.log('')

  if (options.open) openBrowser(uiUrl)

  const shutdown = () => {
    server.close(() => process.exit(0))
    // Streaming SSE connections hold the server open; do not wait forever.
    setTimeout(() => process.exit(0), 500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/** A one-line reachability check, so a wrong --server is obvious immediately. */
async function reportUpstreamHealth(server: string): Promise<void> {
  try {
    const res = await fetch(`${server}/ok`, { signal: AbortSignal.timeout(2500) })
    if (res.ok) {
      console.log('  Connected to the LangGraph server.')
    } else {
      console.log(`  Warning: ${server}/ok returned ${res.status}. The UI will still load.`)
    }
  } catch {
    console.log(`  Warning: could not reach ${server}. Is \`langgraph dev\` running?`)
    console.log('  You can also pick a different server from inside the UI.')
  }
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Headless box, or no browser installed. The URL is already printed.
  }
}

void main()
