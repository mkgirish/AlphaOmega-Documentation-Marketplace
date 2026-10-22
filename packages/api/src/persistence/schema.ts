// CMP-4's registrations table as drizzle sees it; drizzle/ holds the committed migrations.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Scaffold baseline, no longer written. */
  fullName: text('full_name'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
