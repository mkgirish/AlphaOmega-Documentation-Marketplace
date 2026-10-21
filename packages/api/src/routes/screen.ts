// ST-1 — CMP-3 serves the built registration screen (SCR-1) and its content-hashed
// bundle from the one container, so the page needs nothing outside it (AC-1, AC-7).
// Browsers asking for HTML at / get the screen; other probes keep IF-2's liveness answer.
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { errorEnvelope } from '@app/shared'
import type { FastifyInstance } from 'fastify'
import { sendError } from '../plugins/errors.js'

const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
// One plain file name: no separators, no traversal, no hidden files.
const ASSET_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
const SCREEN_UNAVAILABLE = 'The registration screen is not available.'

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

export function registerScreenRoutes(app: FastifyInstance, webRoot: string): void {
  app.get('/', async (request, reply) => {
    reply.header('vary', 'Accept')
    if (!(request.headers.accept ?? '').includes('text/html')) return { ok: true }
    const page = await readOrNull(join(webRoot, 'index.html'))
    if (page === null) return reply.code(503).header('cache-control', 'no-store').send(errorEnvelope(SCREEN_UNAVAILABLE))
    return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(page)
  })

  app.get<{ Params: { file: string } }>('/assets/:file', async (request, reply) => {
    const { file } = request.params
    const type = ASSET_TYPES[extname(file)]
    const asset = type !== undefined && ASSET_NAME.test(file) ? await readOrNull(join(webRoot, 'assets', file)) : null
    if (asset === null) return sendError(reply, 404)
    return reply.header('cache-control', 'public, max-age=31536000, immutable').type(type).send(asset)
  })
}
