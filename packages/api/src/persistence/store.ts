// IF-3 — the one write the API makes. Insert only: the app role holds INSERT and nothing
// else, so there is no RETURNING and no read path (AD-8).
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { registrations } from './schema.js'

export interface NewRegistration {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
  readonly createdAt: string
}

export interface RegistrationStore {
  insert(row: NewRegistration): Promise<void>
}

export function createPgStore(pool: Pool): RegistrationStore {
  const db = drizzle(pool)
  return {
    async insert(row) {
      await db.insert(registrations).values(row)
    },
  }
}

export class StoreUnavailableError extends Error {
  readonly code = 'store_unavailable'
}

/** The store when no database is configured: every insert fails, so POST answers 500. */
export const unavailableStore: RegistrationStore = {
  async insert() {
    throw new StoreUnavailableError('no database configured')
  },
}
