// The only write the API makes: one INSERT per accepted registration, with no RETURNING,
// because the app role may INSERT and nothing else (AD-8).
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { registrations } from './schema.js'

export interface NewRegistration {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
  /** Whole UTC seconds from formatUtcSeconds(). */
  readonly createdAt: string
}

export interface RegistrationRepository {
  insert(row: NewRegistration): Promise<void>
}

export function createRegistrationRepository(db: NodePgDatabase): RegistrationRepository {
  return {
    async insert(row) {
      await db.insert(registrations).values(row)
    },
  }
}
