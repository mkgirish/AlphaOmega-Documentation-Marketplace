// CMP-3 persistence port. Routes depend on this interface, never on SQL; the PostgreSQL
// repository and its supervised database land with the story that stores registrations.

/** A registration that has passed validation, its values already normalised. */
export interface RegistrationRecord {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
}

export interface RegistrationRepository {
  insert(record: RegistrationRecord): Promise<void>
}

/** Wired when no database is configured: every insert fails, so the route answers 500. */
export const unavailableRepository: RegistrationRepository = {
  async insert() {
    throw Object.assign(new Error('No registration database is configured.'), { code: 'DB_UNAVAILABLE' })
  },
}
