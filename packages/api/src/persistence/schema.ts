// CMP-4 — the registrations table as drizzle sees it; drizzle/ holds the committed SQL.
// created_at is text holding formatUtcSeconds() output, so psql reads it as written (AC-3).
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  createdAt: text('created_at').notNull(),
})
