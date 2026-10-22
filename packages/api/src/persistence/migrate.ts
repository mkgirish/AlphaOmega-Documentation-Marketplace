// Applies the committed SQL migrations under packages/api/drizzle in file-name order, each
// once and in its own transaction, recording what ran in schema_migrations (AD-8, rule 18).
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'

// src/persistence and dist/persistence both sit two levels under packages/api.
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** Returns the names of the migrations this call applied. */
export async function migrate(pool: pg.Pool, directory: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  const client = await pool.connect()
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const done = new Set(rows.map((row) => row.name))
    const applied: string[] = []
    for (const name of files.filter((file) => !done.has(file))) {
      const sql = await readFile(join(directory, name), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
      applied.push(name)
    }
    return applied
  } finally {
    client.release()
  }
}
