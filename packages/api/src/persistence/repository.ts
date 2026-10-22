// CMP-3 persistence — the only place a registration reaches PostgreSQL. Inserts go through
// drizzle's query builder (no raw SQL) and never use RETURNING: the app role holds INSERT only.
import { drizzle } from 'drizzle-orm/node-postgres'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type pg from 'pg'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export interface NewRegistration {
  /** A UUIDv7 from uuidV7(), so ids sort in insertion order. */
  readonly id: string
  readonly fullName: string
  readonly email: string
  /** Whole UTC seconds. */
  readonly createdAt: Date
}

export interface RegistrationRepository {
  insert(row: NewRegistration): Promise<void>
}

export function createRegistrationRepository(pool: pg.Pool): RegistrationRepository {
  const db = drizzle(pool)
  return {
    async insert(row) {
      await db.insert(registrations).values(row)
    },
  }
}

/** Used when no database is configured: every insert fails, so POST answers 500. */
export const unavailableRepository: RegistrationRepository = {
  async insert() {
    throw Object.assign(new Error('No database is configured.'), { code: 'DB_UNAVAILABLE' })
  },
}
