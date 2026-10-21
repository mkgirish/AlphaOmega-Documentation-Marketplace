// AD-5 — every error answer is the shared envelope with a fixed message per status: no
// route, query, submitted value or internal detail is ever echoed back, and none is cached.
import { errorEnvelope } from '@app/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { SECURITY_HEADERS } from './security-headers.js'

export const NOT_FOUND = 'Not found.'
const MESSAGES: Readonly<Record<number, string>> = {
  400: 'Bad request.',
  404: NOT_FOUND,
  405: 'Method not allowed.',
  413: 'Request too large.',
  415: 'Unsupported media type.',
  500: 'Something went wrong.',
}

/** The status Fastify or a route attached to an error: a known 4xx is kept, anything else is a 500. */
function statusOf(error: { statusCode?: number }): number {
  const status = error.statusCode ?? 500
  return status >= 400 && status < 500 ? status : 500
}

export function sendError(reply: FastifyReply, status: number): FastifyReply {
  return reply
    .code(status)
    .header('cache-control', 'no-store')
    .send(errorEnvelope(MESSAGES[status] ?? MESSAGES[400]))
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler(async (_request, reply) => sendError(reply, 404))
  app.setErrorHandler(async (error: { statusCode?: number }, _request, reply) => sendError(reply, statusOf(error)))
}

/** Fastify's own request errors (a bad URL, say) bypass the hooks, so they carry the headers here. */
export function frameworkError(error: { statusCode?: number }, _request: unknown, reply: FastifyReply): void {
  sendError(reply.headers(SECURITY_HEADERS), statusOf(error))
}
