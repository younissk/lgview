import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { handleProxy } from './cli/proxy'

/**
 * Mount the production reverse proxy inside the Vite dev server, so `npm run
 * dev` talks to LangGraph over exactly the same path as the shipped CLI.
 */
function lgviewProxy(): PluginOption {
  const defaultUpstream = process.env.LGVIEW_SERVER ?? 'http://127.0.0.1:2024'
  return {
    name: 'lgview-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/__lgview/config') {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ defaultServer: defaultUpstream, version: 'dev', hasApiKey: false }))
          return
        }
        void handleProxy(req, res, {
          defaultUpstream,
          onError: (err, target) => {
            const message = err instanceof Error ? err.message : String(err)
            server.config.logger.error(`lgview proxy${target ? ` -> ${target}` : ''}: ${message}`)
          },
        }).then((handled) => {
          if (!handled) next()
        })
      })
    },
  }
}

export default defineConfig({
  root: 'web',
  plugins: [react(), lgviewProxy()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: { port: 5173, strictPort: false },
})
