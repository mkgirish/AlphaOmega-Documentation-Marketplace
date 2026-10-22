import { readdirSync } from 'node:fs'
import type pg from 'pg'
import { describe, expect, it } from 'vitest'
import { applyMigrations } from './migrate.js'
import { createPgStore, unavailableStore } from './repository.js'

// ST-10 — what the persistence layer sends to PostgreSQL, recorded without a database:
// the one parameterised INSERT (no RETURNING) and the committed migrations, each once.
// registrations.db.test.ts proves the same against a real server.
type Call = { text: string; values?: unknown[] }

function recordingPool(options: { applied?: string[]; failOn?: string } = {}): { pool: pg.Pool; calls: Call[] } {
  const calls: Call[] = []
  const query = async (q: string | { text: string }, values?: unknown[]) => {
    const text = typeof q === 'string' ? q : q.text
    calls.push({ text, values })
    if (options.failOn !== undefined && text.includes(options.failOn)) throw new Error('failed')
    if (text.startsWith('SELECT name FROM schema_migrations')) {
      return { rows: (options.applied ?? []).map((name) => ({ name })), rowCount: 0 }
    }
    return { rows: [], rowCount: 1 }
  }
  const client = { query, release: () => calls.push({ text: 'release' }) }
  const pool = { query, connect: async () => client } as unknown as pg.Pool
  return { pool, calls }
}

const MIGRATIONS = readdirSync(new URL('../../drizzle/', import.meta.url))
  .filter((name) => name.endsWith('.sql'))
  .sort()

describe('the registration INSERT @story:ST-10 @criterion:AC-1', () => {
  it('stores the values as given through one parameterised INSERT with no RETURNING', async () => {
    const { pool, calls } = recordingPool()
    const createdAt = new Date('2026-10-22T10:00:00Z')
    await createPgStore(pool).insert({ firstName: "O'Brien", lastName: 'José', email: 'a@b.io', phone: '4155550132', createdAt })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.text).toMatch(/^insert into "registrations"/)
    expect(call?.text).not.toMatch(/returning/i)
    expect(call?.text).not.toContain("O'Brien")
    expect(call?.values).toEqual(expect.arrayContaining(["O'Brien", 'José', 'a@b.io', '4155550132']))
  })

  it('fails every write when no database is configured', async () => {
    await expect(
      unavailableStore.insert({ firstName: 'a', lastName: 'b', email: 'c', phone: 'd', createdAt: new Date() }),
    ).rejects.toMatchObject({
      code: 'db_unavailable',
    })
  })
})

describe('applyMigrations @story:ST-10 @criterion:AC-6', () => {
  it('applies every committed migration in name order, each in its own transaction', async () => {
    const { pool, calls } = recordingPool()
    await applyMigrations(pool)
    expect(MIGRATIONS).toContain('0001_visitor_names.sql')
    const recorded = calls.filter((c) => c.text.startsWith('INSERT INTO schema_migrations')).map((c) => c.values?.[0])
    expect(recorded).toEqual(MIGRATIONS)
    expect(calls.filter((c) => c.text === 'BEGIN')).toHaveLength(MIGRATIONS.length)
    expect(calls.filter((c) => c.text === 'COMMIT')).toHaveLength(MIGRATIONS.length)
    expect(calls.at(-1)?.text).toBe('release')
  })

  it('skips migrations already recorded', async () => {
    const { pool, calls } = recordingPool({ applied: MIGRATIONS })
    await applyMigrations(pool)
    expect(calls.some((c) => c.text === 'BEGIN')).toBe(false)
  })

  it('rolls back a failing migration, records nothing for it and releases the client', async () => {
    const { pool, calls } = recordingPool({ failOn: 'ALTER TABLE registrations' })
    await expect(applyMigrations(pool)).rejects.toThrow('failed')
    const recorded = calls.filter((c) => c.text.startsWith('INSERT INTO schema_migrations')).map((c) => c.values?.[0])
    expect(recorded).toEqual(['0000_init.sql'])
    expect(calls.map((c) => c.text).slice(-2)).toEqual(['ROLLBACK', 'release'])
  })
})
