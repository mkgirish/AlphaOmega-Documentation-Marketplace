// A pg pool and its drizzle handle for DATABASE_URL. Pool errors on idle clients are logged
// by SQLSTATE only, so a dropped connection never crashes the process or leaks detail.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { logger } from '../observability/index.js'

export interface Database {
  readonly db: NodePgDatabase
  readonly pool: pg.Pool
  close(): Promise<void>
}

export function openDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 })
  pool.on('error', (err: Error & { code?: string }) => {
    logger.error({ sqlstate: err.code ?? 'unknown' }, 'db.pool_error')
  })
  return { db: drizzle(pool), pool, close: () => pool.end() }
}
