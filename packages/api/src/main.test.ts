import { describe, expect, it } from 'vitest'
import { buildApp } from './main.js'

describe('registration-api (scaffold baseline)', () => {
  it('answers the IF-2 liveness probe', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })
})
