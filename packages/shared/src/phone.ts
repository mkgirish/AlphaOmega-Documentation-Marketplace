// ST-8 — the US phone rule, shared by the screen's phone field and the API (AD-2, AD-3).
import { z } from 'zod'

/** Shown under the phone field and returned by the API for any phone that is not a 10-digit US number. */
export const invalidPhoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

/** The ways a number may be written: ASCII digits plus spaces, parentheses, dots and hyphens. */
const writtenPhone = /^[0-9 ().-]+$/

/** NANP: a 3-digit area code and a 3-digit exchange, each starting 2–9, then 4 digits. */
const nanpDigits = /^[2-9][0-9]{2}[2-9][0-9]{6}$/

/** Keep only the ASCII digits of a value, as the phone field does with every keystroke and paste. */
export function phoneDigits(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

/** Whether a submitted value is a 10-digit NANP number written without a +1 or leading 1. */
export function isUsPhone(value: string): boolean {
  const trimmed = value.trim()
  return writtenPhone.test(trimmed) && nanpDigits.test(phoneDigits(trimmed))
}

/** The ten digits to store for a valid phone, or undefined when the value is not one. */
export function normalisePhone(value: string): string | undefined {
  return isUsPhone(value) ? phoneDigits(value) : undefined
}

/** The phone rule as a schema: accepts any valid writing and outputs the ten stored digits. */
export const phoneSchema = z
  .string({ required_error: invalidPhoneMessage, invalid_type_error: invalidPhoneMessage })
  .refine(isUsPhone, invalidPhoneMessage)
  .transform(phoneDigits)

/**
 * Format the digits of a value as they are typed: (415) 555-0132 from the fourth digit on.
 * A value starting with 1, or longer than ten digits, is left as its bare digits.
 */
export function formatPhoneAsTyped(value: string): string {
  const digits = phoneDigits(value)
  if (digits.length <= 3 || digits.length > 10 || digits.startsWith('1')) return digits
  const area = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}`
  return digits.length <= 6 ? area : `${area}-${digits.slice(6)}`
}

/** The caret position just after the given number of digits in a formatted value, or before its first digit for none. */
function caretAfterDigits(value: string, count: number): number {
  if (count === 0) return Math.max(value.search(/[0-9]/), 0)
  let seen = 0
  let i = 0
  while (seen < count && i < value.length) if (/[0-9]/.test(value[i++]!)) seen++
  return i
}

export interface PhoneEdit {
  readonly value: string
  readonly caret: number
}

/**
 * Apply one edit of the phone field: `raw` and `caret` are what the browser holds after the
 * keystroke or paste, `previous` the value shown before it. Non-digits are dropped, the
 * digits are reformatted, and the caret stays beside the same digit. When a single Backspace
 * or Delete removed only a formatting character, the neighbouring digit in that direction goes instead.
 */
export function editPhone(previous: string, raw: string, caret: number, direction: 'backward' | 'forward' = 'backward'): PhoneEdit {
  let digits = phoneDigits(raw)
  let before = phoneDigits(raw.slice(0, caret)).length
  const removedOneCharAtCaret = raw === previous.slice(0, caret) + previous.slice(caret + 1)
  if (removedOneCharAtCaret && digits === phoneDigits(previous)) {
    if (direction === 'forward') {
      digits = digits.slice(0, before) + digits.slice(before + 1)
    } else if (before > 0) {
      digits = digits.slice(0, before - 1) + digits.slice(before)
      before -= 1
    }
  }
  const value = formatPhoneAsTyped(digits)
  return { value, caret: caretAfterDigits(value, before) }
}
