// CMP-5 — in-process logging, trace spans and metrics. prom-client imports are confined
// to this directory (AD-14). Scaffold baseline: a pino logger to stdout and a metrics
// registry; the span plumbing lands with the trace-crosses-every-call story.
import pino from 'pino'
import { collectDefaultMetrics, Registry } from 'prom-client'

export type Logger = pino.Logger

/** A logger writing JSON lines to destination (stdout when omitted). */
export function createLogger(destination?: pino.DestinationStream, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({ level }, destination)
}

export const logger = createLogger()

export const metrics = new Registry()
collectDefaultMetrics({ register: metrics })
