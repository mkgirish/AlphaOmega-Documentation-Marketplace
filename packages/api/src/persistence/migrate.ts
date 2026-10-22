// Applies the committed drizzle/*.sql migrations in name order. Each is idempotent, so
// running them against an already-migrated database changes nothing.
import { readdir, readFile } from 'node:fs/promises'
import pg from 'pg'

const MIGRATIONS = new URL('../../drizzle/', import.meta.url)

export async function applyMigrations(connectionString: string): Promise<void> {
  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort()
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    for (const file of files) {
      await client.query(await readFile(new URL(file, MIGRATIONS), 'utf8'))
    }
  } finally {
    await client.end()
  }
}
