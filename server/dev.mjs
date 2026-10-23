// Local preview of the whole site: the page plus /api/launch on http://127.0.0.1:4351. Not shipped in the container.
// `node server/dev.mjs --simulate` points the launch finder at the real $CTAP launch, to see the "live" state.
import { createServer } from 'node:http'
import { createApi } from './api.mjs'

const simulate = process.argv.includes('--simulate')
const env = {
  ...process.env,
  DEV_STATIC: '1',
  ...(simulate ? { UNC_CREATOR: 'DA5pURRr7wo2kqBDgk8XukgsQsGr7HMKXhghny72L5mU', UNC_SINCE: '2026-10-20T19:29:00Z', UNC_SYMBOL: 'CTAP' } : {}),
}
const port = Number(process.env.DEV_PORT ?? 4351)
createServer(createApi({ env })).listen(port, '127.0.0.1', () => console.log(`uncatchable dev on http://127.0.0.1:${port}${simulate ? ' (simulating a live launch with $CTAP data)' : ''}`))
