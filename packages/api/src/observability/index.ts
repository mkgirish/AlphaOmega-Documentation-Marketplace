// CMP-5 — in-process logging, trace spans and metrics. prom-client imports are confined
// to this directory (AD-14). A pino logger to stdout, a metrics registry and the
// registration.rejected event (rejection.ts); the span plumbing lands with the
// trace-crosses-every-call story.
import pino from 'pino'
import { collectDefaultMetrics, Registry } from 'prom-client'

/** A JSON logger writing to stdout, or to the given stream in tests. No hostname is logged. */
export function createLogger(destination?: { write(line: string): unknown }) {
  const options = {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { pid: process.pid },
    // Backstop for careless callers: client addresses and submitted values are dropped.
    redact: {
      paths: ['ip', 'remoteAddress', 'req.ip', 'req.remoteAddress', 'req.headers', 'value', '*.value'],
      remove: true,
    },
  }
  return destination === undefined ? pino(options) : pino(options, destination)
}

export const logger = createLogger()

export const metrics = new Registry()
collectDefaultMetrics({ register: metrics })
