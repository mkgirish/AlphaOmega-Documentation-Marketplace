// ST-9 — the registration body POST /api/registrations accepts. It builds on CMP-2's
// normalise() and messages; the email rule and its message are the story's wording and
// belong in packages/shared beside registrationInput once CMP-2 adopts them.
import { messages, normalise } from '@app/shared'
import { z, type ZodError } from 'zod'

export const EMAIL_MESSAGE = 'Enter an email like name@example.com.'
export const EMAIL_MAX_LENGTH = 254
export const FULL_NAME_MAX_LENGTH = 200
export const FULL_NAME_TOO_LONG = `Full name must be ${FULL_NAME_MAX_LENGTH} characters or fewer.`
export const FULL_NAME_UNPRINTABLE = 'Full name can only hold printable characters.'

// Control and bidi-override characters cannot be stored as text or would reorder what is
// shown. The email pattern already refuses them.
const UNPRINTABLE = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u

const normalised = (value: unknown): unknown => (typeof value === 'string' ? normalise(value) : value)

export const registrationBody = z
  .object({
    fullName: z.preprocess(
      normalised,
      z
        .string({ message: messages.required('Full name') })
        .min(1, messages.required('Full name'))
        .max(FULL_NAME_MAX_LENGTH, FULL_NAME_TOO_LONG)
        .refine((value) => !UNPRINTABLE.test(value), FULL_NAME_UNPRINTABLE),
    ),
    email: z.preprocess(normalised, z.string({ message: EMAIL_MESSAGE }).max(EMAIL_MAX_LENGTH, EMAIL_MESSAGE).email(EMAIL_MESSAGE)),
  })
  .strict()

export type RegistrationBody = z.infer<typeof registrationBody>

const FIELDS = new Set<string>(Object.keys(registrationBody.shape))

/** One error per known field, in issue order; problems with the body as a whole map to none. */
export function fieldErrors(error: ZodError): { path: string; message: string }[] {
  const seen = new Map<string, string>()
  for (const issue of error.issues) {
    const [field] = issue.path
    if (typeof field === 'string' && FIELDS.has(field) && !seen.has(field)) seen.set(field, issue.message)
  }
  return [...seen].map(([path, message]) => ({ path, message }))
}
