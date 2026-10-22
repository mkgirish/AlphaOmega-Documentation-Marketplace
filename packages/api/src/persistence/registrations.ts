// CMP-3 repository — the only code that writes registrations. Inserts never use RETURNING:
// the app role may INSERT and nothing more, and no response carries the row id.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { RegistrationFields } from '../registration/rules.js'
import type { Database } from './database.js'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export interface RegistrationRepository {
  /** Stores one registration; createdAt is truncated to whole UTC seconds. */
  insert(fields: RegistrationFields, createdAt: Date): Promise<void>
}

export function registrationRepository(database: Database): RegistrationRepository {
  const db: NodePgDatabase = database.db
  return {
    async insert(fields, createdAt) {
      await db.insert(registrations).values({
        firstName: fields.firstName,
        lastName: fields.lastName,
        email: fields.email,
        phone: fields.phone,
        createdAt: new Date(Math.floor(createdAt.getTime() / 1000) * 1000),
      })
    },
  }
}
