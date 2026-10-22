// The only way a registration reaches the database: one INSERT, nothing read back, so no
// route can ever answer with a stored row or its id.
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import type { NewRegistration } from '../registrations/rules.js'
import { registrations } from './schema.js'

export interface RegistrationStore {
  insert(registration: NewRegistration): Promise<void>
  close(): Promise<void>
}

export function createPgStore(pool: Pool): RegistrationStore {
  const db = drizzle(pool)
  return {
    async insert(registration) {
      await db.insert(registrations).values(registration)
    },
    close: () => pool.end(),
  }
}

/** Stands in when no database is configured: every save fails as a 500, nothing else does. */
export const unavailableStore: RegistrationStore = {
  insert: async () => {
    throw Object.assign(new Error('No database is configured.'), { code: 'db_unavailable' })
  },
  close: async () => {},
}
