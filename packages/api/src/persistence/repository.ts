// CMP-3 persistence: the one write the API makes. Drizzle builds the parameterised INSERT,
// with no RETURNING — the app role may only insert, and createdAt is chosen here.
import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import type { RegistrationValues } from '../registration/rules.js'
import { registrations } from './schema.js'

export interface NewRegistration extends RegistrationValues {
  /** Whole UTC seconds. */
  createdAt: Date
}

export interface RegistrationStore {
  insert(row: NewRegistration): Promise<void>
}

export function createPgStore(pool: pg.Pool): RegistrationStore {
  const db = drizzle({ client: pool })
  return {
    async insert(row) {
      await db.insert(registrations).values(row)
    },
  }
}

/** The store used when no database is configured: every write fails, answered as 500. */
export const unavailableStore: RegistrationStore = {
  async insert() {
    throw Object.assign(new Error('No database is configured.'), { code: 'db_unavailable' })
  },
}
