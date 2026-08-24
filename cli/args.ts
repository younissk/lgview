/** Command-line arguments for lgview. Kept apart from the entrypoint so that
 * importing this module never starts a server. */
import { parseArgs } from 'node:util'

export const DEFAULT_SERVER = 'http://127.0.0.1:2024'
export const DEFAULT_PORT = 4141

export interface Options {
  server: string
  port: number
  host: string
  apiKey?: string
  open: boolean
}

export function parseCliArgs(argv: string[]): Options | { help: true } | { version: true } {
  const { values } = parseArgs({
    args: argv,
    options: {
      server: { type: 'string', short: 's' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      'api-key': { type: 'string' },
      open: { type: 'boolean', default: true },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowNegative: true,
  })

  if (values.help) return { help: true }
  if (values.version) return { version: true }

  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port must be an integer between 0 and 65535, got ${values.port}`)
  }

  return {
    server: normalizeServerUrl(values.server ?? DEFAULT_SERVER),
    port,
    host: values.host ?? '127.0.0.1',
    apiKey: values['api-key'],
    open: values.open !== false,
  }
}

/** Accept `localhost:2024` and `http://localhost:2024/` alike. */
export function normalizeServerUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `http://${input}`
  const url = new URL(withScheme)
  return url.toString().replace(/\/+$/, '')
}
