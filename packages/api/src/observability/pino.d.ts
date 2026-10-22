// The lockfile resolves pino 6, which ships no type declarations. This declares the
// small surface CMP-5 uses so the logger stays typed.
declare module 'pino' {
  export interface LogFn {
    (object: object, message?: string): void
    (message: string): void
  }

  export interface Logger {
    level: string
    fatal: LogFn
    error: LogFn
    warn: LogFn
    info: LogFn
    debug: LogFn
    trace: LogFn
  }

  export interface LoggerOptions {
    level?: string
  }

  function pino(options?: LoggerOptions, destination?: NodeJS.WritableStream): Logger

  export default pino
}
