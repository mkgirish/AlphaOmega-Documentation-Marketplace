// CMP-4's registrations table as drizzle sees it; drizzle/0000_init.sql is the source of truth.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})
