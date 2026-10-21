import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'
import { start } from './main.js'

// ST-1 AC-1 — the container entrypoint starts with no environment at all; PORT and HOST
// only override the defaults. Here an ephemeral port stands in for 3000.
describe('ST-1 AC-1: the entrypoint listens and serves the hardened surface', () => {
  it('needs no environment by default and answers over real HTTP on the configured port', async () => {
    expect(loadConfig({})).toEqual({ port: 3000, host: '0.0.0.0' })
    const app = await start({ PORT: '0', HOST: '127.0.0.1' })
    try {
      const { port } = app.server.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}/admin`)
      expect(res.status).toBe(404)
      expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
      expect(await res.json()).toEqual({ error: { message: 'Not found.' } })
    } finally {
      await app.close()
    }
  })
})
