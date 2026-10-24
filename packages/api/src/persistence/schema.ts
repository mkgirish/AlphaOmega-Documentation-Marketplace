// CMP-4 — the registrations table as drizzle sees it; drizzle/0001_visitor_registrations.sql
// is the committed migration that creates it. created_at is text holding formatUtcSeconds()
// output, so psql reads back exactly the ISO 8601 UTC whole seconds the API answered with.
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  createdAt: text('created_at').notNull(),
})
