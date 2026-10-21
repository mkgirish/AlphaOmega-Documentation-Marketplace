import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

describe('loadConfig @story:ST-1 @criterion:AC-1', () => {
  it('needs no environment variable: port 3000 on all interfaces, screen from packages/web/dist', () => {
    expect(loadConfig({})).toMatchObject({
      port: 3000,
      host: '0.0.0.0',
      webRoot: resolve(REPO_ROOT, 'packages/web/dist'),
    })
    const config = loadConfig({ PORT: '8080', HOST: '127.0.0.1' })
    expect(config).toMatchObject({ port: 8080, host: '127.0.0.1', webRoot: resolve(REPO_ROOT, 'packages/web/dist') })
  })
})
