// CMP-3 persistence: the registrations repository behind POST /api/registrations, and the
// runner that applies the committed drizzle/ migrations in order at startup. Inserts never
// use RETURNING; created_at is set from the app clock at whole seconds.
import { readdir, readFile } from 'node:fs/promises'
import { drizzle } from 'drizzle-orm/node-postgres'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type pg from 'pg'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export interface NewRegistration {
  readonly fullName: string
  readonly email: string
  /** Ten NANP digits, as normalisePhone() returns them. */
  readonly phone: string
  readonly createdAt: Date
}

export interface RegistrationRepository {
  insert(row: NewRegistration): Promise<void>
}

export function pgRegistrations(pool: pg.Pool): RegistrationRepository {
  const db = drizzle(pool)
  return {
    async insert(row) {
      await db.insert(registrations).values(row)
    },
  }
}

/** Stands in until a database is configured: every insert fails, so POST answers 500. */
export const unavailableRegistrations: RegistrationRepository = {
  async insert() {
    throw Object.assign(new Error('No database is configured.'), { code: 'db_unavailable' })
  },
}

const MIGRATIONS = new URL('../../drizzle/', import.meta.url)

// Serialises concurrent starters: only one session applies migrations at a time.
const MIGRATION_LOCK = 812_008

/** Applies every committed migration in file-name order; each one is idempotent. */
export async function migrate(pool: pg.Pool): Promise<void> {
  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith('.sql')).sort()
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    for (const file of files) {
      await client.query(await readFile(new URL(file, MIGRATIONS), 'utf8'))
    }
  } finally {
    // Closing the session frees the lock even when a migration failed part-way.
    client.release(true)
  }
}
