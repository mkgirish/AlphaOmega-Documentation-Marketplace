// AD-16 HTTP hardening: the same strict headers on every response, AD-5 error envelopes
// that never echo the request, and no CORS (the screen is served from the API's origin).
import type { Socket } from 'node:net'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { errorEnvelope, type ErrorEnvelope } from '@app/shared'
import { logger } from '../observability/index.js'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  // Vite inlines small fonts as data: URIs.
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  // API answers are never cached; static assets override this with their own policy.
  'cache-control': 'no-store',
}

export const NOT_FOUND = 'Not found.'

const CLIENT_ERRORS: Readonly<Record<number, string>> = {
  400: 'The request could not be read.',
  403: 'Cross-site requests are refused.',
  413: 'The request is too large.',
  415: 'Unsupported content type.',
  431: 'The request headers are too large.',
}

/** The AD-5 envelope for a client error status; the message never depends on the request. */
export function clientErrorEnvelope(status: number): ErrorEnvelope {
  return errorEnvelope(CLIENT_ERRORS[status] ?? 'The request could not be processed.')
}

/** ST-11 validation envelope: fixed messages per field, never the submitted value. */
export interface ValidationEnvelope {
  error: 'validation'
  fields: Partial<Record<string, string[]>>
}

export const validationEnvelope = (fields: ValidationEnvelope['fields']): ValidationEnvelope => ({ error: 'validation', fields })

export const errorEnvelopeSchema = {
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

export const validationEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'fields'],
  properties: {
    error: { type: 'string', const: 'validation' },
    fields: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
  },
} as const

/** Bodies above this are refused with 413 before any handler runs. */
export const BODY_LIMIT = 16 * 1024

function badRequest(_error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void {
  void reply
    .headers(SECURITY_HEADERS)
    .code(400)
    .send(errorEnvelope(CLIENT_ERRORS[400] ?? ''))
}

// Requests Node cannot even parse never reach Fastify; answer them in the same shape.
function rawClientError(error: Error & { code?: string }, socket: Socket): void {
  if (!socket.writable) return
  const status = error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400
  const body = JSON.stringify(errorEnvelope(CLIENT_ERRORS[status] ?? ''))
  const headers = Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}\r\n`)
  socket.end(
    `HTTP/1.1 ${status} ${status === 431 ? 'Request Header Fields Too Large' : 'Bad Request'}\r\n` +
      headers.join('') +
      `content-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\n` +
      `connection: close\r\n\r\n${body}`,
  )
}

/** Fastify constructor options that keep framework-level failures inside the envelope. */
export const securityServerOptions = {
  bodyLimit: BODY_LIMIT,
  trustProxy: false,
  frameworkErrors: badRequest,
  clientErrorHandler: rawClientError,
} as const

export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(SECURITY_HEADERS)
  })

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send(errorEnvelope(NOT_FOUND))
  })

  app.setErrorHandler(async (error: FastifyError, _request, reply) => sendError(error, reply))
}

/** Answers a failure in the envelope: client errors by status, anything else as a bare 500. */
export function sendError(error: FastifyError, reply: FastifyReply, log: Logger = logger): FastifyReply {
  const status = error.statusCode ?? 500
  if (status >= 400 && status < 500) {
    return reply.code(status).send(clientErrorEnvelope(status))
  }
  log.error({ code: error.code ?? 'unknown' }, 'request.failed')
  return reply.code(500).send(errorEnvelope('Something went wrong.'))
}
