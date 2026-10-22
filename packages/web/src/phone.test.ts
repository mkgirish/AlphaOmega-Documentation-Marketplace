import { describe, expect, it } from 'vitest'
import { formatPhone, isUsPhone, phoneChange, phoneDigits, phoneKey, phoneMessage } from './phone.js'

// ST-8 — the phone field: what it accepts, how it formats as the visitor types, and how
// editing in the middle keeps the caret in place. Pure functions; App wires them to the input.

/** Type each character at the end of the field, as the visitor would. */
function typeInto(text: string, start = ''): string {
  let value = start
  for (const char of text) value = phoneChange(value + char, value.length + 1).value
  return value
}

const accepted = ['4155550132', '(415) 555-0132', '415.555.0132']
const rejected = ['abc123', '5550132', '41555501329', '0155550132', '+44 20 7946 0958', '+1 415 555 0132', '1-415-555-0132']
const badPrefix = ['4150550132', '4151550132', '1155550132']

describe('Feature: Enter a US phone number and be told exactly when it is wrong', () => {
  it('the message is the story’s copy, character for character', () => {
    expect(phoneMessage).toBe('Enter a 10-digit US number without +1, e.g. (415) 555-0132.')
  })

  describe('Scenario Outline: Common ways of writing a US number are accepted @AC-1', () => {
    it.each(accepted)('When I enter "%s" Then it is accepted as 4155550132', (phone) => {
      expect(isUsPhone(phone)).toBe(true)
      expect(phoneDigits(phone)).toBe('4155550132')
      const shown = phoneChange(phone, phone.length).value
      expect(shown).toBe('(415) 555-0132')
      expect(isUsPhone(shown)).toBe(true)
      expect(phoneDigits(shown)).toBe('4155550132')
    })
  })

  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2', () => {
    it.each(rejected)('When I enter "%s" Then it is rejected, as typed and as the field keeps it', (phone) => {
      expect(isUsPhone(phone)).toBe(false)
      expect(isUsPhone(phoneChange(phone, phone.length).value)).toBe(false)
    })

    it('rejects an empty value and anything but digits and separators', () => {
      expect(isUsPhone('')).toBe(false)
      expect(isUsPhone('415555013a')).toBe(false)
      expect(isUsPhone('415_555_0132')).toBe(false)
      expect(isUsPhone('+4155550132')).toBe(false)
    })
  })

  describe('Scenario Outline: An area code or exchange starting with 0 or 1 is rejected @AC-3', () => {
    it.each(badPrefix)('When I enter "%s" Then it is rejected', (phone) => {
      expect(isUsPhone(phone)).toBe(false)
      expect(isUsPhone(phoneChange(phone, phone.length).value)).toBe(false)
    })

    it('accepts every area code and exchange that starts with 2 to 9', () => {
      for (const lead of '23456789') {
        expect(isUsPhone(`${lead}155550132`)).toBe(true)
        expect(isUsPhone(`415${lead}550132`)).toBe(true)
      }
      expect(isUsPhone('4150550132')).toBe(false)
      expect(isUsPhone('0155550132')).toBe(false)
    })
  })

  describe('Scenario: The number is formatted as I type @AC-4', () => {
    it('Given the phone field is empty, When I type "4155550132", Then the phone field shows "(415) 555-0132"', () => {
      expect(typeInto('4155550132')).toBe('(415) 555-0132')
    })

    it('shows the formatting grow digit by digit', () => {
      const seen: string[] = []
      let value = ''
      for (const char of '4155550132') {
        const edit = phoneChange(value + char, value.length + 1)
        value = edit.value
        expect(edit.caret).toBe(value.length)
        seen.push(value)
      }
      expect(seen).toEqual([
        '4',
        '41',
        '415',
        '(415) 5',
        '(415) 55',
        '(415) 555',
        '(415) 555-0',
        '(415) 555-01',
        '(415) 555-013',
        '(415) 555-0132',
      ])
    })

    it('formats from digits only', () => {
      expect(formatPhone('')).toBe('')
      expect(formatPhone('415')).toBe('415')
      expect(formatPhone('4155')).toBe('(415) 5')
      expect(formatPhone('4155550')).toBe('(415) 555-0')
      expect(formatPhone('0155550132')).toBe('(015) 555-0132')
      expect(formatPhone('41555501329')).toBe('41555501329')
    })
  })

  describe('Scenario: A number with a leading 1 is left as typed @AC-4', () => {
    it('Given the phone field is empty, When I type "14155550132", Then the phone field shows "14155550132"', () => {
      expect(typeInto('14155550132')).toBe('14155550132')
      expect(formatPhone('1')).toBe('1')
      expect(formatPhone('1415555')).toBe('1415555')
    })
  })

  describe('Scenario: Non-digits are ignored as I type @AC-5', () => {
    it('Given the phone field is empty, When I type "+abc415", Then the phone field holds only the digits "415"', () => {
      expect(typeInto('+abc415')).toBe('415')
    })

    it('a letter typed in the middle produces nothing and the caret stays put', () => {
      // "(415) 5|55" with "x" typed at the caret
      expect(phoneChange('(415) 5x55', 8)).toEqual({ value: '(415) 555', caret: 7 })
      expect(phoneChange('+', 1)).toEqual({ value: '', caret: 0 })
    })
  })

  describe('Scenario: A pasted number keeps only its digits @AC-5', () => {
    it('When I paste "+1 (415) 555-0132", Then the field holds "14155550132", unformatted because it starts with "1"', () => {
      const pasted = '+1 (415) 555-0132'
      const edit = phoneChange(pasted, pasted.length)
      expect(edit.value).toBe('14155550132')
      expect(phoneDigits(edit.value)).toBe('14155550132')
      expect(edit.caret).toBe(11)
    })

    it('a number pasted into the middle lands where the caret was', () => {
      // "41|5" with "999" pasted after "41"
      expect(phoneChange('419995', 5)).toEqual({ value: '(419) 995', caret: 8 })
    })
  })

  describe('Scenario: Correcting a digit in the middle keeps my place @AC-6', () => {
    it('Given "(415) 555-0132", When I place the cursor after "555" and press Backspace, Then the digits read "415550132" and the cursor stays where the deleted digit was', () => {
      const shown = '(415) 555-0132'
      const caret = shown.indexOf('555') + 3
      // A digit before the caret: the browser deletes it natively, then the change reformats.
      expect(phoneKey('Backspace', shown, caret, caret)).toBeNull()
      const afterNative = shown.slice(0, caret - 1) + shown.slice(caret)
      const edit = phoneChange(afterNative, caret - 1)
      expect(phoneDigits(edit.value)).toBe('415550132')
      expect(edit.value).toBe('(415) 550-132')
      expect(edit.caret).toBe(caret - 1)
      expect(edit.value.slice(0, edit.caret)).toBe('(415) 55')
    })

    it('Backspace just after "-" deletes the digit before it, not the dash', () => {
      const shown = '(415) 555-0132'
      const caret = shown.indexOf('-') + 1
      const edit = phoneKey('Backspace', shown, caret, caret)
      expect(edit).toEqual({ value: '(415) 550-132', caret: 8 })
    })

    it('Backspace just after the space deletes the last area-code digit', () => {
      const shown = '(415) 555-0132'
      const edit = phoneKey('Backspace', shown, 6, 6)
      expect(edit).toEqual({ value: '(415) 550-132', caret: 3 })
      expect(phoneDigits(edit?.value ?? '')).toBe('415550132')
    })

    it('Backspace just after ")" deletes the last area-code digit', () => {
      const shown = '(415) 555-0132'
      expect(phoneKey('Backspace', shown, 5, 5)).toEqual({ value: '(415) 550-132', caret: 3 })
    })

    it('Backspace after the opening "(" has no digit to delete and leaves the value alone', () => {
      expect(phoneKey('Backspace', '(415) 555-0132', 1, 1)).toEqual({ value: '(415) 555-0132', caret: 0 })
    })

    it('Delete just before "-" deletes the digit after it', () => {
      const shown = '(415) 555-0132'
      const caret = shown.indexOf('-')
      expect(phoneKey('Delete', shown, caret, caret)).toEqual({ value: '(415) 555-132', caret })
    })

    it('Delete just before ") " deletes the first exchange digit', () => {
      expect(phoneKey('Delete', '(415) 555-0132', 4, 4)).toEqual({ value: '(415) 550-132', caret: 4 })
    })

    it('Delete at "(" deletes the first digit', () => {
      expect(phoneKey('Delete', '(415) 555-0132', 0, 0)).toEqual({ value: '155550132', caret: 0 })
    })

    it('Delete at the end has nothing to delete and leaves the browser to it', () => {
      expect(phoneKey('Delete', '(415) 555-0132', 14, 14)).toBeNull()
      expect(phoneKey('Delete', '(415) 555-0132', 10, 10)).toBeNull()
    })

    it('Backspace at the start or after a digit is the browser’s own', () => {
      expect(phoneKey('Backspace', '(415) 555-0132', 0, 0)).toBeNull()
      expect(phoneKey('Backspace', '415', 2, 2)).toBeNull()
    })

    it('a selection is deleted by the browser and the change reformats it', () => {
      expect(phoneKey('Backspace', '(415) 555-0132', 4, 9)).toBeNull()
      expect(phoneKey('Delete', '(415) 555-0132', 4, 9)).toBeNull()
      expect(phoneChange('(415-0132', 4)).toEqual({ value: '(415) 013-2', caret: 4 })
    })

    it.each(['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', '5'])(
      '%s is left to the browser, so the caret moves natively',
      (key) => {
        expect(phoneKey(key, '(415) 555-0132', 9, 9)).toBeNull()
      },
    )

    it('typing a digit in the middle keeps the caret just after it', () => {
      // "(415) 5|50-132" with "5" typed at the caret
      expect(phoneChange('(415) 5550-132', 8)).toEqual({ value: '(415) 555-0132', caret: 8 })
      // after a caret placed after the space, the digit lands as the first exchange digit
      expect(phoneChange('(415) 9555-0132', 7)).toEqual({ value: '41595550132', caret: 4 })
    })

    it('a caret beyond the value is held at its end', () => {
      expect(phoneChange('415', 9)).toEqual({ value: '415', caret: 3 })
    })
  })
})
