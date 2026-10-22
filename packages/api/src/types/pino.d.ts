// The frozen lockfile resolves pino 6, which ships no type declarations; this covers the
// part of its API that observability/index.ts uses.
declare module 'pino' {
  namespace pino {
    interface LogFn {
      (message: string): void
      (fields: object, message?: string): void
    }
    interface Logger {
      trace: LogFn
      debug: LogFn
      info: LogFn
      warn: LogFn
      error: LogFn
      fatal: LogFn
    }
  }
  function pino(options?: { level?: string }): pino.Logger
  export = pino
}
