// Applies the committed SQL migrations under packages/api/drizzle in name order, each once
// and in its own transaction, recording what ran in schema_migrations.
import { readdir, readFile } from 'node:fs/promises'
import type pg from 'pg'

// src/persistence and dist/persistence both sit two levels under packages/api.
const MIGRATIONS = new URL('../../drizzle/', import.meta.url)

export async function applyMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)')
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.name))
    const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort()
    for (const name of files.filter((file) => !applied.has(file))) {
      const migration = await readFile(new URL(name, MIGRATIONS), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(migration)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    client.release()
  }
}
