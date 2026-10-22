// ST-8 — the US phone rule the API applies to every submission (AC-8). A phone is
// accepted only when, with spaces, dots, dashes and brackets removed, it is exactly ten
// NANP digits: an area code and exchange each starting 2–9. No '+1' or leading 1.
export const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

const SEPARATORS = /[\s().-]/g
const NANP = /^[2-9][0-9]{2}[2-9][0-9]{6}$/

/** The ten stored digits of an acceptable US number, or null when it is not one. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(SEPARATORS, '')
  return NANP.test(digits) ? digits : null
}
