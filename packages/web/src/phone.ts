// ST-8 — the phone field (SCR-1): digits only as typed or pasted (AC-5), shown as
// (415) 555-0132 unless it starts with 1 (AC-4), Backspace that keeps the caret's place
// (AC-6), and the rule Submit applies (AC-1, AC-2, AC-3). No regex: each character is checked.
// CMP-2 carries no phone rule yet, so the screen holds it here until the shared rules do.

/** The phone message, worded exactly as the story's acceptance criteria give it. */
export const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

/** The field's text and where the caret sits in it after an edit. */
export interface PhoneEdit {
  readonly value: string
  readonly caret: number
}

/** The selection an input reports, as much of it as the editing needs. */
export interface PhoneTarget {
  readonly value: string
  readonly selectionStart: number | null
  readonly selectionEnd: number | null
}

// The separators a written US number may carry: (415) 555-0132, 415.555.0132.
const separators = ' ()-.'

const isDigit = (ch: string) => ch >= '0' && ch <= '9'

/** Only the digits of a value, in order. */
export function phoneDigits(value: string): string {
  let digits = ''
  for (const ch of value) if (isDigit(ch)) digits += ch
  return digits
}

/** Digits as the field shows them: (415) 555-0132 as it fills; a leading 1 or more than ten digits stay as typed. */
export function formatPhone(digits: string): string {
  if (digits === '' || digits.startsWith('1') || digits.length > 10) return digits
  const area = digits.slice(0, 3)
  const exchange = digits.slice(3, 6)
  const line = digits.slice(6)
  if (exchange === '') return `(${area}`
  if (line === '') return `(${area}) ${exchange}`
  return `(${area}) ${exchange}-${line}`
}

/** The caret index just after the count-th digit of a formatted value, or before its first digit. */
function caretAfterDigits(value: string, count: number): number {
  if (count === 0) return Math.max(0, [...value].findIndex(isDigit))
  let seen = 0
  let at = 0
  while (seen < count && at < value.length) if (isDigit(value[at++])) seen++
  return at
}

/** Reformat whatever the browser left in the field, keeping the caret after the same digit. */
export function editPhone(raw: string, caret: number): PhoneEdit {
  const value = formatPhone(phoneDigits(raw))
  return { value, caret: caretAfterDigits(value, phoneDigits(raw.slice(0, caret)).length) }
}

/** Backspace just after a separator deletes the digit before it, not the separator; undefined leaves it to the browser. */
export function backspacePhone(value: string, caret: number): PhoneEdit | undefined {
  if (caret === 0 || isDigit(value[caret - 1])) return undefined
  let at = caret - 1
  while (at >= 0 && !isDigit(value[at])) at--
  if (at < 0) return undefined
  return editPhone(value.slice(0, at) + value.slice(at + 1), at)
}

/** Delete just before a separator deletes the digit after it, not the separator; undefined leaves it to the browser. */
export function deletePhone(value: string, caret: number): PhoneEdit | undefined {
  let at = caret
  while (at < value.length && !isDigit(value[at])) at++
  if (at === caret || at === value.length) return undefined
  return editPhone(value.slice(0, at) + value.slice(at + 1), caret)
}

/**
 * The keydown the field handles itself: a plain, collapsed-caret Backspace or Delete next to a
 * separator. Modified keys (word or line deletes) and IME composition are left to the browser.
 */
export function phoneKey(key: string, target: PhoneTarget, modified = false): PhoneEdit | undefined {
  const { selectionStart, selectionEnd } = target
  if (modified || selectionStart === null || selectionStart !== selectionEnd) return undefined
  if (key === 'Backspace') return backspacePhone(target.value, selectionStart)
  if (key === 'Delete') return deletePhone(target.value, selectionStart)
  return undefined
}

/** The phone message when the value is not a 10-digit US number, area code and exchange starting 2–9. */
export function checkPhone(value: string): string | undefined {
  for (const ch of value) if (!isDigit(ch) && !separators.includes(ch)) return phoneMessage
  const digits = phoneDigits(value)
  if (digits.length !== 10 || digits[0] < '2' || digits[3] < '2') return phoneMessage
  return undefined
}
