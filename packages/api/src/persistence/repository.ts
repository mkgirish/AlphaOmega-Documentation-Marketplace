// The write-only registrations repository: one INSERT through drizzle, no RETURNING, so
// the app role needs nothing beyond INSERT and no row id ever comes back.
import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import { registrations } from './schema.js'

export interface NewRegistration {
  readonly fullName: string
  readonly email: string
  /** The ten digits of a valid US number. */
  readonly phone: string
  /** Whole UTC seconds. */
  readonly createdAt: Date
}

export interface RegistrationRepository {
  insert(row: NewRegistration): Promise<void>
}

export function createPgRepository(pool: pg.Pool): RegistrationRepository {
  const db = drizzle(pool)
  return {
    async insert(row) {
      await db.insert(registrations).values(row)
    },
  }
}

/** Stands in when no database is configured: every insert fails, so POST answers 500. */
export const unavailableRepository: RegistrationRepository = {
  async insert() {
    throw Object.assign(new Error('No database is configured.'), { code: 'DB_UNCONFIGURED' })
  },
}
