// CMP-3 repository for the write-only registrations table (AD-8). Inserts go through
// drizzle's parameterised builder with no RETURNING, so the app role needs only INSERT
// and no row id ever reaches a response.
import type pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { RegistrationFields } from '../routes/registration-rules.js'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  email: text('email').notNull(),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A validated, normalised registration and the whole UTC second it was received. */
export interface StoredRegistration extends RegistrationFields {
  createdAt: Date
}

export interface RegistrationStore {
  save(registration: StoredRegistration): Promise<void>
}

export function createPgRegistrationStore(pool: pg.Pool): RegistrationStore {
  const db = drizzle(pool)
  return {
    async save(registration) {
      await db.insert(registrations).values({
        fullName: `${registration.firstName} ${registration.lastName}`,
        firstName: registration.firstName,
        lastName: registration.lastName,
        email: registration.email,
        phone: registration.phone,
        createdAt: registration.createdAt,
      })
    },
  }
}
