import { describe, expect, it } from 'vitest'
import { attentionSummary, firstFlagged, missingFields } from './validation.js'

// ST-3 — the screen's required-field check (CMP-1). "Empty" is decided by the shared
// normalise() from CMP-2, so a value of only whitespace counts as empty.
const valid = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }

const copy = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
} as const

describe('Feature: Be stopped when I leave a field empty', () => {
  describe('Scenario Outline: A missing field stops the registration @AC-1', () => {
    it.each(Object.keys(copy) as (keyof typeof copy)[])('flags only %s when it alone is empty', (name) => {
      expect(missingFields({ ...valid, [name]: '' })).toEqual({ [name]: copy[name] })
    })

    it('flags nothing when every field holds a value', () => {
      expect(missingFields(valid)).toEqual({})
    })
  })

  describe('Scenario: A field of only spaces counts as empty @AC-2', () => {
    it.each(['   ', ' ', '\t', ' \t \n ', '  '])('treats %j in the last name as empty', (blank) => {
      expect(missingFields({ ...valid, lastName: blank })).toEqual({ lastName: copy.lastName })
    })

    it('does not flag a value with spaces around real text', () => {
      expect(missingFields({ ...valid, firstName: '  Jane  ' })).toEqual({})
    })
  })

  describe('Scenario: Each empty field says what it needs @AC-3', () => {
    it('gives every field of an empty form its own message, character for character', () => {
      expect(missingFields({ firstName: '', lastName: '', email: '', phone: '' })).toEqual(copy)
    })

    it('the summary box reads how many fields need attention', () => {
      expect(attentionSummary(4)).toBe('4 fields need attention. Check the messages below.')
      expect(attentionSummary(2)).toBe('2 fields need attention. Check the messages below.')
      expect(attentionSummary(1)).toBe('1 field needs attention. Check the messages below.')
    })

    it('the first flagged field in tab order is the one focus moves to', () => {
      expect(firstFlagged(copy)).toBe('firstName')
      expect(firstFlagged({ phone: copy.phone, email: copy.email })).toBe('email')
      expect(firstFlagged({ phone: copy.phone })).toBe('phone')
      expect(firstFlagged({})).toBeUndefined()
    })
  })
})
