// CMP-5 — in-process logging, trace spans and metrics. prom-client imports are confined
// to this directory (AD-14). A pino logger to stdout, a metrics registry and the
// registration.rejected event; the span plumbing lands with the trace-crosses-every-call story.
export { createLogger, logger, metrics, type Logger } from './logger.js'
export {
  BODY_FIELD,
  recordRegistrationRejected,
  rejectedFields,
  type IssueLike,
  type RejectedField,
  type Rejection,
  type RejectionReason,
} from './rejection.js'
