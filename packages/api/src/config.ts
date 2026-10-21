// Runtime configuration, read from the environment (SQ-7). Scaffold baseline.
export interface Config {
  readonly port: number
  readonly host: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: env.PORT ? Number(env.PORT) : 3000,
    host: env.HOST ?? '0.0.0.0',
  }
}
