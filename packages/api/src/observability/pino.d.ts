// The locked pino ships no type declarations; this is the slice of its API CMP-5 uses.
declare module 'pino' {
  namespace pino {
    interface LoggerOptions {
      level?: string
    }
    interface DestinationStream {
      write(line: string): void
    }
    interface LogFn {
      (obj: object, msg?: string): void
      (msg: string): void
    }
    interface Logger {
      level: string
      fatal: LogFn
      error: LogFn
      warn: LogFn
      info: LogFn
      debug: LogFn
      trace: LogFn
    }
  }
  function pino(options?: pino.LoggerOptions, destination?: pino.DestinationStream): pino.Logger
  export default pino
}
