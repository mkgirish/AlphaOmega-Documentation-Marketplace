// ST-8 — the US phone rule and the phone field's as-you-type formatting (AC-1 to AC-6).
// CMP-2 does not export a phone rule yet, so it lives here, once, with no regex: the API
// applies the same rule to the request body (AC-8).

/** The one phone message, shown under the field and sent by the API (AC-2, AC-3). */
export const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

const isDigit = (char: string) => char >= '0' && char <= '9'

/** Characters a visitor may write between the digits: spaces, dashes, dots and parentheses. */
const separators = ' -.()'

/** Area codes and exchanges start with 2 to 9 (NANP). */
const leads = '23456789'

/** Only the digits of a value, in order. */
export function phoneDigits(value: string): string {
  return [...value].filter(isDigit).join('')
}

/** A 10-digit US number, written with or without separators; '+' or a country code is rejected. */
export function isUsPhone(value: string): boolean {
  if (![...value].every((char) => isDigit(char) || separators.includes(char))) return false
  const digits = phoneDigits(value)
  return digits.length === 10 && leads.includes(digits[0]) && leads.includes(digits[3])
}

/** Format digits as (415) 555-0132 while they are typed; a leading 1 or an overlong value stays raw (AC-4). */
export function formatPhone(digits: string): string {
  if (digits.length <= 3 || digits[0] === '1' || digits.length > 10) return digits
  const area = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}`
  return digits.length <= 6 ? area : `${area}-${digits.slice(6)}`
}

export interface PhoneEdit {
  readonly value: string
  /** Where the caret goes in the new value. */
  readonly caret: number
}

/** The index just after the nth digit of a formatted value, or 0 for none. */
function afterDigit(value: string, count: number): number {
  let at = 0
  for (let seen = 0; seen < count; at++) if (isDigit(value[at])) seen++
  return at
}

/**
 * Reformat whatever the browser left in the field — typed, pasted or deleted — keeping only
 * digits (AC-5), and keep the caret after the same digit it followed (AC-6).
 */
export function phoneChange(raw: string, caret: number): PhoneEdit {
  const value = formatPhone(phoneDigits(raw))
  return { value, caret: afterDigit(value, phoneDigits(raw.slice(0, caret)).length) }
}

/**
 * Backspace or Delete next to a separator removes the neighbouring digit instead, as the
 * separator would only come back on reformat (AC-6). Null leaves the key to the browser,
 * so Home, End, the arrows and plain digit edits behave natively.
 */
export function phoneKey(key: string, value: string, start: number, end: number): PhoneEdit | null {
  if (start !== end) return null
  if (key === 'Backspace' && start > 0 && !isDigit(value[start - 1])) {
    let at = start - 2
    while (at >= 0 && !isDigit(value[at])) at--
    if (at < 0) return { value, caret: start - 1 }
    return phoneChange(value.slice(0, at) + value.slice(at + 1), at)
  }
  if (key === 'Delete' && start < value.length && !isDigit(value[start])) {
    let at = start + 1
    while (at < value.length && !isDigit(value[at])) at++
    return phoneChange(value.slice(0, at) + value.slice(at + 1), at)
  }
  return null
}
