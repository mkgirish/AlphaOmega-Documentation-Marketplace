import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

// ST-10 — the registrations route stores through PostgreSQL when DATABASE_URL is set.
describe('database configuration @story:ST-10 @criterion:AC-6', () => {
  it('reads DATABASE_URL', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://app@localhost/app' }).databaseUrl).toBe('postgres://app@localhost/app')
  })

  it('leaves the database unconfigured when DATABASE_URL is unset or empty', () => {
    expect(loadConfig({}).databaseUrl).toBeUndefined()
    expect(loadConfig({ DATABASE_URL: '' }).databaseUrl).toBeUndefined()
  })
})
