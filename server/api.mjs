// @ts-check
// uncatchable.fun API: GET /api/launch tells the page whether $UNCATCHABLE is live and, once it is, the CA, pool,
// on-chain tokenomics and the live curve (see launch.mjs). Plain Node, no dependencies.
// In the container nginx proxies /api/ here on 127.0.0.1:8787. DEV_STATIC=1 also serves the page (local testing only).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createLaunchResolver, jsonRpc } from './launch.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Only these paths are served in DEV_STATIC mode, so nothing outside the site (brand/, server/) leaks
const DEV_FILE = /^\/(index\.html|og-image\.png|favicon\.png|apple-touch-icon\.png|img\/[a-z-]+\.webp)$/
const TYPES = /** @type {Record<string, string>} */ ({ html: 'text/html; charset=utf-8', png: 'image/png', webp: 'image/webp' })

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function send(res, status, body, headers = {}) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end(data)
}

/** @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, now?: () => number, log?: (...a: unknown[]) => void }} [opts] */
export function createApi({ env = process.env, fetch: doFetch = fetch, now = Date.now, log = console.log } = {}) {
  // SOLANA_RPC: comma-separated, tried in order
  const rpcUrls = (env.SOLANA_RPC || 'https://gene-v4mswe-fast-mainnet.helius-rpc.com,https://solana-rpc.publicnode.com').split(',').map((u) => u.trim()).filter((u) => /^https:\/\//.test(u))
  const launch = createLaunchResolver({ rpc: jsonRpc(rpcUrls, doFetch), env, now, log })
  const devStatic = env.DEV_STATIC === '1'

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  return async function handle(req, res) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' })
      if (path === '/api/launch') return send(res, 200, await launch.get(), { 'Cache-Control': 'public, max-age=10' })
      if (path === '/api/health') return send(res, 200, { ok: true })
      if (devStatic && (path === '/' || DEV_FILE.test(path))) {
        const file = path === '/' ? 'index.html' : path.slice(1)
        const data = await readFile(join(ROOT, file))
        res.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
        return res.end(data)
      }
      return send(res, 404, { error: 'Not found.' })
    } catch (e) {
      log(`api error: ${/** @type {Error} */ (e)?.stack ?? e}`)
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' })
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const port = Number(process.env.API_PORT ?? 8787)
  const host = process.env.API_HOST ?? '127.0.0.1'
  const server = createServer(createApi())
  server.headersTimeout = 15_000
  server.requestTimeout = 30_000
  server.listen(port, host, () => console.log(`uncatchable API on http://${host}:${port}${process.env.DEV_STATIC === '1' ? ' (also serving the page)' : ''}`))
  for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT'])) process.on(sig, () => server.close(() => process.exit(0)))
}
