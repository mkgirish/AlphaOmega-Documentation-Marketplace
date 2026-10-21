// The registrations table as drizzle sees it; the committed migrations under drizzle/
// are the source of truth for the database itself.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
