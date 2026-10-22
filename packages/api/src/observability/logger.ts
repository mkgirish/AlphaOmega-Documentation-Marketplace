// The process logger and metrics registry. pino writes JSON lines to stdout; tests pass
// their own destination to capture exactly what the container log would hold.
import pino, { type Logger } from 'pino'
import { collectDefaultMetrics, Registry } from 'prom-client'

export type { Logger }

/** A logger writing JSON lines to `destination` (stdout when omitted). */
export function createLogger(destination?: NodeJS.WritableStream): Logger {
  const options = { level: process.env.LOG_LEVEL ?? 'info' }
  return destination === undefined ? pino(options) : pino(options, destination)
}

export const logger = createLogger()

export const metrics = new Registry()
collectDefaultMetrics({ register: metrics })
