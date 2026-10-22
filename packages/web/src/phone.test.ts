import { describe, expect, it } from 'vitest'
import {
  backspacePhone,
  deletePhone,
  checkPhone,
  editPhone,
  formatPhone,
  phoneDigits,
  phoneKey,
  phoneMessage,
  type PhoneEdit,
} from './phone.js'

// ST-8 / SCR-1 — the phone field's editing and the rule the browser applies on Submit.

/** Type each character at the caret, as a browser inserts it, letting the field reformat. */
function type(text: string, from: PhoneEdit = { value: '', caret: 0 }): PhoneEdit[] {
  const steps: PhoneEdit[] = []
  let at = from
  for (const ch of text) {
    at = editPhone(at.value.slice(0, at.caret) + ch + at.value.slice(at.caret), at.caret + 1)
    steps.push(at)
  }
  return steps
}

/** What the field shows after typing the whole text into an empty field. */
const typed = (text: string): PhoneEdit => type(text).at(-1) as PhoneEdit

/** A native Backspace at the caret, deleting the one character before it. */
const nativeBackspace = ({ value, caret }: PhoneEdit): PhoneEdit => editPhone(value.slice(0, caret - 1) + value.slice(caret), caret - 1)

const message = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

describe('Feature: Enter a US phone number and be told exactly when it is wrong', () => {
  it('the phone message reads exactly as the story words it', () => {
    expect(phoneMessage).toBe(message)
  })

  describe('Scenario Outline: Common ways of writing a US number are accepted @AC-1', () => {
    it.each(['4155550132', '(415) 555-0132', '415.555.0132'])(
      'Given valid name and email, When I enter "%s", Then the browser accepts it as 4155550132',
      (phone) => {
        const shown = typed(phone)
        expect(checkPhone(shown.value)).toBeUndefined()
        expect(phoneDigits(shown.value)).toBe('4155550132')
        expect(checkPhone(phone)).toBeUndefined()
        expect(phoneDigits(phone)).toBe('4155550132')
      },
    )
  })

  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2', () => {
    it.each(['abc123', '5550132', '41555501329', '0155550132', '+44 20 7946 0958', '+1 415 555 0132', '1-415-555-0132'])(
      'When I enter "%s" and press Submit, Then the phone message is given',
      (phone) => {
        expect(checkPhone(phone)).toBe(message)
        expect(checkPhone(typed(phone).value)).toBe(message)
      },
    )

    it('an empty phone is rejected with the same message', () => {
      expect(checkPhone('')).toBe(message)
    })
  })

  describe('Scenario Outline: An area code or exchange starting with 0 or 1 is rejected @AC-3', () => {
    it.each(['4150550132', '4151550132', '1155550132', '0155550132'])(
      'When I enter "%s" and press Submit, Then the phone message is given',
      (phone) => {
        expect(checkPhone(phone)).toBe(message)
        expect(checkPhone(typed(phone).value)).toBe(message)
      },
    )

    it('area codes and exchanges starting 2 to 9 pass', () => {
      expect(checkPhone('2125550132')).toBeUndefined()
      expect(checkPhone('9999999999')).toBeUndefined()
      expect(checkPhone('2122000132')).toBeUndefined()
    })
  })

  describe('Scenario: The number is formatted as I type @AC-4', () => {
    it('Given the phone field is empty, When I type "4155550132", Then the phone field shows "(415) 555-0132" as it is typed', () => {
      expect(type('4155550132').map((step) => step.value)).toEqual([
        '(4',
        '(41',
        '(415',
        '(415) 5',
        '(415) 55',
        '(415) 555',
        '(415) 555-0',
        '(415) 555-01',
        '(415) 555-013',
        '(415) 555-0132',
      ])
    })

    it('the caret follows the last typed digit at every step', () => {
      for (const step of type('4155550132')) expect(step.caret).toBe(step.value.length)
    })

    it('formats digits progressively and leaves an empty field empty', () => {
      expect(formatPhone('')).toBe('')
      expect(formatPhone('415')).toBe('(415')
      expect(formatPhone('4155')).toBe('(415) 5')
      expect(formatPhone('4155550')).toBe('(415) 555-0')
      expect(formatPhone('4155550132')).toBe('(415) 555-0132')
    })
  })

  describe('Scenario: A number with a leading 1 is left as typed @AC-4', () => {
    it('Given the phone field is empty, When I type "14155550132", Then the phone field shows "14155550132"', () => {
      const steps = type('14155550132')
      expect(steps.at(-1)).toEqual({ value: '14155550132', caret: 11 })
      for (const step of steps) expect(step.value).toBe(phoneDigits(step.value))
    })

    it('more than ten digits are left unformatted so nothing is hidden', () => {
      expect(formatPhone('41555501329')).toBe('41555501329')
      expect(editPhone('(415) 5955-0132', 8)).toEqual({ value: '41559550132', caret: 5 })
    })
  })

  describe('Scenario: Non-digits are ignored as I type @AC-5', () => {
    it('Given the phone field is empty, When I type "+abc415", Then the phone field holds only the digits "415"', () => {
      const steps = type('+abc415')
      expect(steps.slice(0, 4)).toEqual([
        { value: '', caret: 0 },
        { value: '', caret: 0 },
        { value: '', caret: 0 },
        { value: '', caret: 0 },
      ])
      expect(phoneDigits(steps.at(-1)?.value ?? 'x')).toBe('415')
      expect(steps.at(-1)).toEqual({ value: '(415', caret: 4 })
    })

    it('a letter typed in the middle of a number changes nothing and keeps the caret in place', () => {
      expect(editPhone('(415) 5x55-0132', 8)).toEqual({ value: '(415) 555-0132', caret: 7 })
    })
  })

  describe('Scenario: A pasted number keeps only its digits @AC-5', () => {
    it('Given the phone field is empty, When I paste "+1 (415) 555-0132", Then it holds "14155550132", unformatted because it starts with "1"', () => {
      const pasted = '+1 (415) 555-0132'
      expect(editPhone(pasted, pasted.length)).toEqual({ value: '14155550132', caret: 11 })
    })

    it('a formatted paste is reformatted with the caret after the pasted digits', () => {
      expect(editPhone('415.555.0132', 12)).toEqual({ value: '(415) 555-0132', caret: 14 })
    })
  })

  describe('Scenario: Correcting a digit in the middle keeps my place @AC-6', () => {
    const full: PhoneEdit = { value: '(415) 555-0132', caret: 14 }

    it('Given "(415) 555-0132", When I place the cursor after "555" and press Backspace, Then the digits read "415550132" and the cursor stays where the deleted digit was', () => {
      const after = nativeBackspace({ ...full, caret: 9 })
      expect(phoneDigits(after.value)).toBe('415550132')
      expect(after).toEqual({ value: '(415) 550-132', caret: 8 })
    })

    it('Backspace with the caret just after "-" removes the digit before the "-"', () => {
      const edit = backspacePhone(full.value, 10)
      expect(edit).toEqual({ value: '(415) 550-132', caret: 8 })
    })

    it('Backspace with the caret just after the space removes the digit before ")"', () => {
      expect(backspacePhone(full.value, 6)).toEqual({ value: '(415) 550-132', caret: 3 })
    })

    it('Backspace with the caret just after ")" removes the digit before it', () => {
      expect(backspacePhone(full.value, 5)).toEqual({ value: '(415) 550-132', caret: 3 })
    })

    it('Backspace after a digit, or after "(" with no digit before it, is left to the browser', () => {
      expect(backspacePhone(full.value, 9)).toBeUndefined()
      expect(backspacePhone(full.value, 1)).toBeUndefined()
      expect(backspacePhone(full.value, 0)).toBeUndefined()
    })

    it('typing a digit in the middle keeps the caret after it', () => {
      expect(editPhone('(415) 5955-013', 8)).toEqual({ value: '(415) 595-5013', caret: 8 })
      expect(editPhone('(4155) 555-013', 5)).toEqual({ value: '(415) 555-5013', caret: 7 })
    })

    it('editing at the very start (Home) keeps the caret at the start of the digits', () => {
      expect(editPhone('(45) 555-0132', 1)).toEqual({ value: '(455) 550-132', caret: 1 })
      expect(editPhone('7(415) 555-013', 1)).toEqual({ value: '(741) 555-5013', caret: 2 })
    })

    it('Delete with the caret just before "-", ")" or the space removes the digit after it and keeps the caret', () => {
      expect(deletePhone(full.value, 9)).toEqual({ value: '(415) 555-132', caret: 9 })
      expect(deletePhone(full.value, 4)).toEqual({ value: '(415) 550-132', caret: 4 })
      expect(deletePhone(full.value, 5)).toEqual({ value: '(415) 550-132', caret: 4 })
    })

    it('Delete before a digit, or at the end, is left to the browser', () => {
      expect(deletePhone(full.value, 8)).toBeUndefined()
      expect(deletePhone(full.value, 14)).toBeUndefined()
      expect(deletePhone('(415', 4)).toBeUndefined()
    })

    it('a Delete that only removes a separator leaves the number and the caret where they were', () => {
      expect(editPhone('(415) 5550132', 9)).toEqual({ value: '(415) 555-0132', caret: 9 })
    })
  })

  describe('the keydown handler', () => {
    const target = (value: string, start: number | null, end: number | null = start) => ({
      value,
      selectionStart: start,
      selectionEnd: end,
    })

    it('handles Backspace with a collapsed caret after a separator', () => {
      expect(phoneKey('Backspace', target('(415) 555-0132', 10))).toEqual({ value: '(415) 550-132', caret: 8 })
    })

    it('handles Delete with a collapsed caret before a separator', () => {
      expect(phoneKey('Delete', target('(415) 555-0132', 9))).toEqual({ value: '(415) 555-132', caret: 9 })
    })

    it('leaves word and line deletes (Ctrl, Alt, Meta) and IME composition to the browser', () => {
      expect(phoneKey('Backspace', target('(415) 555-0132', 10), true)).toBeUndefined()
      expect(phoneKey('Delete', target('(415) 555-0132', 9), true)).toBeUndefined()
    })

    it('leaves other keys (arrows, Home, End), selections and unknown carets to the browser', () => {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', '5'])
        expect(phoneKey(key, target('(415) 555-0132', 10))).toBeUndefined()
      expect(phoneKey('Backspace', target('(415) 555-0132', 6, 10))).toBeUndefined()
      expect(phoneKey('Backspace', target('(415) 555-0132', null))).toBeUndefined()
    })
  })
})
