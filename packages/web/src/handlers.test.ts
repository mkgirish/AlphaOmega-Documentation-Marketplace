import { describe, expect, it, vi } from 'vitest'
import { changeHandler, phoneKeyDownHandler, restoreCaret, restoreFocus, type CaretRef } from './handlers.js'

// ST-8 — the phone field's event wiring: each edit dispatches the reformatted value and
// leaves the caret for the next render to place (AC-4, AC-5, AC-6).
const change = (value: string, selectionStart: number | null = value.length) => ({ target: { value, selectionStart } })

describe('Feature: Enter a US phone number and be told exactly when it is wrong — the field handlers', () => {
  describe('Scenario: The number is formatted as I type @AC-4', () => {
    it('When I type the fourth digit, Then the field shows "(415) 5" with the caret after the 5', () => {
      const dispatch = vi.fn()
      const caret: CaretRef = { current: null }
      changeHandler('phone', dispatch, caret)(change('(4155'))
      expect(dispatch).toHaveBeenCalledWith({ type: 'change', field: 'phone', value: '(415) 5' })
      expect(caret.current).toBe(7)
    })
  })

  describe('Scenario: A pasted number keeps only its digits @AC-5', () => {
    it('When I paste "+1 (415) 555-0132", Then the field holds "14155550132" with the caret at its end', () => {
      const dispatch = vi.fn()
      const caret: CaretRef = { current: null }
      changeHandler('phone', dispatch, caret)(change('+1 (415) 555-0132', null))
      expect(dispatch).toHaveBeenCalledWith({ type: 'change', field: 'phone', value: '14155550132' })
      expect(caret.current).toBe(11)
    })
  })

  describe('Scenario: Correcting a digit in the middle keeps my place @AC-6', () => {
    it('Backspace just after "-" deletes the digit before it and keeps the caret there', () => {
      const dispatch = vi.fn()
      const caret: CaretRef = { current: null }
      const preventDefault = vi.fn()
      phoneKeyDownHandler(
        dispatch,
        caret,
      )({ key: 'Backspace', currentTarget: { value: '(415) 555-0132', selectionStart: 10, selectionEnd: 10 }, preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledWith({ type: 'change', field: 'phone', value: '(415) 550-132' })
      expect(caret.current).toBe(8)
    })

    it('other keys and Backspace after a digit are left to the browser', () => {
      const dispatch = vi.fn()
      const caret: CaretRef = { current: null }
      const preventDefault = vi.fn()
      const handler = phoneKeyDownHandler(dispatch, caret)
      handler({ key: 'ArrowLeft', currentTarget: { value: '(415) 555-0132', selectionStart: 10, selectionEnd: 10 }, preventDefault })
      handler({ key: 'Backspace', currentTarget: { value: '(415) 555-0132', selectionStart: 9, selectionEnd: 9 }, preventDefault })
      expect(preventDefault).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
      expect(caret.current).toBeNull()
    })

    it('Ctrl, Alt or Meta with Backspace, and keys during IME composition, are left to the browser', () => {
      const dispatch = vi.fn()
      const preventDefault = vi.fn()
      const handler = phoneKeyDownHandler(dispatch, { current: null })
      const currentTarget = { value: '(415) 555-0132', selectionStart: 10, selectionEnd: 10 }
      handler({ key: 'Backspace', currentTarget, ctrlKey: true, preventDefault })
      handler({ key: 'Backspace', currentTarget, altKey: true, preventDefault })
      handler({ key: 'Backspace', currentTarget, metaKey: true, preventDefault })
      handler({ key: 'Backspace', currentTarget, nativeEvent: { isComposing: true }, preventDefault })
      expect(preventDefault).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()
    })

    it('the next render puts the caret where the edit left it, once', () => {
      const setSelectionRange = vi.fn()
      const caret: CaretRef = { current: 8 }
      restoreCaret(caret, { setSelectionRange })
      expect(setSelectionRange).toHaveBeenCalledWith(8, 8)
      expect(caret.current).toBeNull()
      restoreCaret(caret, { setSelectionRange })
      expect(setSelectionRange).toHaveBeenCalledTimes(1)
    })

    it('a pending caret waits while the phone input is not mounted', () => {
      const caret: CaretRef = { current: 3 }
      restoreCaret(caret, null)
      expect(caret.current).toBe(3)
    })
  })

  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2', () => {
    it('focus moves to the flagged phone field once, after its message is rendered', () => {
      const phone = { focus: vi.fn() }
      const email = { focus: vi.fn() }
      const pending: { current: 'phone' | null } = { current: 'phone' }
      restoreFocus(pending, { phone, email })
      expect(phone.focus).toHaveBeenCalledTimes(1)
      expect(email.focus).not.toHaveBeenCalled()
      expect(pending.current).toBeNull()
      restoreFocus(pending, { phone, email })
      expect(phone.focus).toHaveBeenCalledTimes(1)
    })

    it('nothing pending, or an unmounted field, moves no focus', () => {
      const pending: { current: 'phone' | null } = { current: 'phone' }
      restoreFocus(pending, { phone: null })
      expect(pending.current).toBeNull()
      restoreFocus({ current: null }, {})
    })
  })

  it('the other fields take what was typed, untouched, and leave the caret alone', () => {
    const dispatch = vi.fn()
    const caret: CaretRef = { current: null }
    changeHandler('email', dispatch, caret)(change('+a b'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'change', field: 'email', value: '+a b' })
    expect(caret.current).toBeNull()
  })
})
