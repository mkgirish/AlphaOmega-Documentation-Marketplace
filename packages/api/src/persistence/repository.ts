// The write-only registrations repository: one INSERT, no RETURNING, no read path.
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { logger } from '../observability/index.js'
import { registrations } from './schema.js'

export interface NewRegistration {
  readonly fullName: string
  readonly email: string
  /** Whole UTC seconds; the API stamps it so no value has to be read back. */
  readonly createdAt: Date
}

export interface RegistrationRepository {
  insert(row: NewRegistration): Promise<void>
}

export interface ClosableRegistrationRepository extends RegistrationRepository {
  close(): Promise<void>
}

export function createPgRepository(connectionString: string): ClosableRegistrationRepository {
  // An unreachable database answers 500 quickly, and an idle client dropped by a restart
  // is logged by SQLSTATE alone instead of crashing the process.
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 })
  pool.on('error', (error: Error & { code?: string }) => logger.error({ code: error.code ?? 'unknown' }, 'request.failed'))
  const db = drizzle(pool)
  return {
    async insert(row) {
      await db.insert(registrations).values({ fullName: row.fullName, email: row.email, createdAt: row.createdAt })
    },
    close: () => pool.end(),
  }
}

/** Used when no database is configured: every write fails, so POST answers 500. */
export const unavailableRepository: RegistrationRepository = {
  insert: async () => {
    throw Object.assign(new Error('No database is configured.'), { code: 'db_unavailable' })
  },
}
