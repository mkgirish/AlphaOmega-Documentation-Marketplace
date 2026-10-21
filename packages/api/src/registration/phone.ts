// ST-8 — the US phone rule. A 10-digit NANP number: area code and exchange each start
// with 2–9, written bare or with spaces, dots, dashes and a parenthesised area code; no
// country code. The API stores the ten digits.
//
// The rule and its message belong in CMP-2 (packages/shared) beside the other field rules;
// this part may only change packages/api, so they live here until CMP-2 exports them.

export const PHONE_MESSAGE = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

// Area code (bare, or in parentheses followed by an optional space), exchange and line,
// with at most one space, dot or dash between groups. ASCII digits only: +, letters,
// full-width or invisible characters never match.
const US_PHONE = /^(?:\(([2-9][0-9]{2})\) ?|([2-9][0-9]{2})[ .-]?)([2-9][0-9]{2})[ .-]?([0-9]{4})$/

/** The number's ten digits when it is a valid US number, otherwise null. */
export function parseUsPhone(value: string): string | null {
  const match = US_PHONE.exec(value.trim())
  return match === null ? null : `${match[1] ?? match[2]}${match[3]}${match[4]}`
}
