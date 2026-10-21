// AD-16 — the fixed response headers every answer carries, the page above all: scripts,
// styles, fetches and frames are limited to the container itself. No CORS is enabled.
import type { FastifyInstance } from 'fastify'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.headers(SECURITY_HEADERS)
    return payload
  })
}
