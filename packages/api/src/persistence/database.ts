// CMP-3 persistence — one pg pool wrapped by drizzle, and the committed drizzle/ migrations
// applied through drizzle's migrator (never schema pushed to a live database).
import { fileURLToPath } from 'node:url'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { logger } from '../observability/index.js'

// src/ and dist/ both sit one level under packages/api, beside drizzle/.
const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))

export interface Database {
  readonly db: NodePgDatabase
  close(): Promise<void>
}

export interface OpenOptions {
  /** Schema unqualified table names resolve to; tests use one each to stay isolated. */
  readonly searchPath?: string
}

// Schema names reach libpq's options string and drizzle's migrator: plain identifiers only.
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error('schema name must be a plain lower-case identifier')
  return name
}

export function openDatabase(url: string, options: OpenOptions = {}): Database {
  const pool = new pg.Pool({
    connectionString: url,
    ...(options.searchPath === undefined ? {} : { options: `-c search_path=${identifier(options.searchPath)}` }),
  })
  // An idle client losing its connection must not crash the process; log the code only.
  pool.on('error', (error: Error & { code?: string }) => {
    logger.error({ code: error.code ?? 'unknown' }, 'db.connection_lost')
  })
  return { db: drizzle(pool), close: () => pool.end() }
}

export async function migrate(database: Database, options: { migrationsSchema?: string } = {}): Promise<void> {
  const { migrationsSchema } = options
  await applyMigrations(database.db, {
    migrationsFolder: MIGRATIONS,
    ...(migrationsSchema === undefined ? {} : { migrationsSchema: identifier(migrationsSchema) }),
  })
}
