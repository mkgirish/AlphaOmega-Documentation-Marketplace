// ST-1 — the registration screen (CMP-1's built bundle) served by CMP-3 from the one
// origin, so the page needs nothing outside the container (AC-1, AC-7). GET / keeps the
// IF-2 liveness JSON for probes and answers browsers, which ask for text/html, with the page.
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { errorEnvelope } from '@app/shared'
import { NOT_FOUND } from '../plugins/security.js'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

// Vite fingerprints every file under assets/, so a cached copy can never be stale.
const IMMUTABLE = 'public, max-age=31536000, immutable'

const healthSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: { message: { type: 'string' } },
    },
  },
} as const

/** True when the Accept header lists text/html with a non-zero quality. */
export function acceptsHtml(accept: string | undefined): boolean {
  return (accept ?? '').split(',').some((entry) => {
    const [type, ...params] = entry.split(';').map((part) => part.trim().toLowerCase())
    if (type !== 'text/html') return false
    const q = params.find((param) => param.startsWith('q='))
    return q === undefined || Number(q.slice(2)) > 0
  })
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

/** Reads a regular file that, after resolving symlinks, still lies inside root. */
async function readContained(root: string, requested: string): Promise<Buffer | null> {
  try {
    const realRoot = await realpath(root)
    const real = await realpath(resolve(root, requested))
    if (!real.startsWith(realRoot + sep) || !(await stat(real)).isFile()) return null
    return await readFile(real)
  } catch {
    return null
  }
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send(errorEnvelope(NOT_FOUND))
}

export function registerScreen(app: FastifyInstance, options: { webRoot: string }): void {
  const assetsRoot = resolve(options.webRoot, 'assets')

  app.get('/', { schema: { response: { 200: healthSchema, 503: errorSchema } } }, async (request, reply) => {
    reply.header('vary', 'Accept')
    if (!acceptsHtml(request.headers.accept)) {
      return { ok: true }
    }
    const page = await readOrNull(join(options.webRoot, 'index.html'))
    if (page === null) {
      return reply.code(503).send(errorEnvelope('The registration screen is not available.'))
    }
    return reply.type('text/html; charset=utf-8').send(page)
  })

  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => {
    const requested = request.params['*']
    const body = requested.includes('\0') ? null : await readContained(assetsRoot, requested)
    if (body === null) {
      return notFound(reply)
    }
    return reply
      .type(CONTENT_TYPES[extname(requested).toLowerCase()] ?? 'application/octet-stream')
      .header('cache-control', IMMUTABLE)
      .send(body)
  })
}
