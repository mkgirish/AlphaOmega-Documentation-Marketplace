// ST-8 — the US phone rule (CMP-2). The screen formats and validates with these, and the API
// validates with the same schema, so a number is judged the same way on both sides (AD-3).
import { z } from 'zod'

/** Human-facing phone messages; re-exported through `messages` in index.ts. */
export const phoneMessages = {
  invalidPhone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
  requiredPhone: 'Phone number is required.',
} as const

/** The separators a visitor may write a number with: spaces, parentheses, dots and hyphens. */
const WRITTEN_PHONE = /^[0-9 ().-]+$/
/** NANP: a 10-digit number whose area code and exchange each start with 2–9. */
const NANP = /^[2-9][0-9]{2}[2-9][0-9]{6}$/

/** Keep only the ASCII digits of a value, in order — what typing or pasting into the field keeps. */
export function phoneDigits(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

/** The 10 digits to store for a written US number, or null when it is not a valid one. */
export function normalisePhone(value: string): string | null {
  const trimmed = value.trim()
  if (!WRITTEN_PHONE.test(trimmed)) return null
  const digits = phoneDigits(trimmed)
  return NANP.test(digits) ? digits : null
}

export function isValidUsPhone(value: string): boolean {
  return normalisePhone(value) !== null
}

/** The phone field's rule: blank is required, anything else must be a US number; yields 10 digits. */
export const phoneNumber = z
  .string({ invalid_type_error: phoneMessages.invalidPhone, required_error: phoneMessages.requiredPhone })
  .transform((value, ctx) => {
    if (value.trim() === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: phoneMessages.requiredPhone })
      return z.NEVER
    }
    const digits = normalisePhone(value)
    if (digits === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: phoneMessages.invalidPhone })
      return z.NEVER
    }
    return digits
  })

/**
 * Format the field as it is typed: (415) 555-0132 progressively, from the fourth digit on.
 * A value starting with 1, or longer than ten digits, is left as bare digits.
 */
export function formatPhoneAsTyped(value: string): string {
  const digits = phoneDigits(value)
  if (digits.length <= 3 || digits.length > 10 || digits.startsWith('1')) return digits
  const area = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}`
  return digits.length <= 6 ? area : `${area}-${digits.slice(6)}`
}

const clamp = (caret: number, value: string) => (Number.isNaN(caret) ? value.length : Math.min(Math.max(caret, 0), value.length))

/** How many digits sit before the cursor position in a shown value. */
export function phoneDigitsBefore(shown: string, caret: number): number {
  return phoneDigits(shown.slice(0, clamp(caret, shown))).length
}

/** The cursor position just after the given number of digits in a shown value. */
export function phoneCaretAfterDigits(shown: string, count: number): number {
  if (count <= 0) return 0
  let seen = 0
  for (let i = 0; i < shown.length; i += 1) {
    if (/[0-9]/.test(shown[i] as string)) seen += 1
    if (seen === count) return i + 1
  }
  return shown.length
}

/**
 * Backspace at a cursor: remove the nearest digit before it (skipping separators), reformat,
 * and keep the cursor where that digit was.
 */
export function backspacePhone(shown: string, caret: number): { value: string; caret: number } {
  const at = clamp(caret, shown)
  const before = phoneDigitsBefore(shown, at)
  if (before === 0) return { value: shown, caret: at }
  const digits = phoneDigits(shown)
  const value = formatPhoneAsTyped(digits.slice(0, before - 1) + digits.slice(before))
  return { value, caret: phoneCaretAfterDigits(value, before - 1) }
}
