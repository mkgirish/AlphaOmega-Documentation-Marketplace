import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'
import { initialState, type FieldErrors, type FormState } from './reducer.js'
import { missingFields } from './validation.js'

// ST-3 / SCR-1 — the screen after a Submit stopped by an empty field. Rendered to static
// markup from the reducer state the stopped Submit leaves behind (the web package has no
// DOM test environment); focus and the browser-level checks are covered in submit.test.ts.
function render(values: FormState['values'], errors: FieldErrors = missingFields(values)): string {
  return renderToStaticMarkup(<App initial={{ ...initialState, values, errors }} />)
}

const count = (html: string, needle: string) => html.split(needle).length - 1

function tagWithId(html: string, id: string): string {
  const at = html.indexOf(` id="${id}"`)
  expect(at, `element #${id}`).toBeGreaterThan(-1)
  const start = html.lastIndexOf('<', at)
  return html.slice(start, html.indexOf('>', at) + 1)
}

const attr = (tag: string, name: string): string | undefined => {
  const at = tag.indexOf(` ${name}="`)
  if (at === -1) return undefined
  const from = at + name.length + 3
  return tag.slice(from, tag.indexOf('"', from))
}

const fields = [
  { id: 'firstName', label: 'First name', message: 'Enter your first name.' },
  { id: 'lastName', label: 'Last name', message: 'Enter your last name.' },
  { id: 'email', label: 'Email', message: 'Enter an email like name@example.com.' },
  { id: 'phone', label: 'Phone number', message: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.' },
] as const

const empty = initialState.values

describe('Feature: Be stopped when I leave a field empty', () => {
  describe('Scenario: Each empty field says what it needs @AC-3', () => {
    const html = render(empty)

    it.each(fields)('Then "$message" appears directly under "$label"', ({ id, message }) => {
      const input = tagWithId(html, id)
      const error = tagWithId(html, `${id}-error`)
      const at = html.indexOf(error)
      expect(at).toBeGreaterThan(html.indexOf(input))
      expect(html.slice(at + error.length).startsWith(`${message}<`)).toBe(true)
      // Directly under its own input: nothing of the next field comes between them.
      const next = html.indexOf('<label', html.indexOf(input))
      expect(next === -1 ? html.indexOf('<button') : next).toBeGreaterThan(at)
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect((attr(input, 'aria-describedby') ?? '').split(' ')).toContain(`${id}-error`)
    })

    it('the phone keeps its hint described too, after its message', () => {
      expect(attr(tagWithId(html, 'phone'), 'aria-describedby')).toBe('phone-error phone-hint')
      expect(html.indexOf(tagWithId(html, 'phone-hint'))).toBeGreaterThan(html.indexOf(tagWithId(html, 'phone-error')))
    })

    it('And a summary box reads "4 fields need attention. Check the messages below." above the fields', () => {
      const summary = tagWithId(html, 'error-summary')
      expect(attr(summary, 'role')).toBe('alert')
      expect(html).toContain(`${summary}4 fields need attention. Check the messages below.<`)
      expect(count(html, 'role="alert"')).toBe(1)
      expect(html.indexOf(summary)).toBeLessThan(html.indexOf(tagWithId(html, 'firstName')))
    })

    it('the messages and the summary add no inline style', () => {
      expect(count(html, 'style=')).toBe(0)
    })
  })

  describe('Scenario: What I typed is kept when I missed a field @AC-5', () => {
    const html = render({ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' })

    it('Then "First name", "Last name" and "Email" still hold what I typed', () => {
      expect(attr(tagWithId(html, 'firstName'), 'value')).toBe('Jane')
      expect(attr(tagWithId(html, 'lastName'), 'value')).toBe('Doe')
      expect(attr(tagWithId(html, 'email'), 'value')).toBe('jane.doe@example.com')
      expect(attr(tagWithId(html, 'phone'), 'value')).toBe('')
    })

    it('only the phone is flagged and the summary counts one field', () => {
      expect(count(html, 'aria-invalid="true"')).toBe(1)
      expect(attr(tagWithId(html, 'phone'), 'aria-invalid')).toBe('true')
      for (const id of ['firstName', 'lastName', 'email']) {
        expect(html).not.toContain(`id="${id}-error"`)
        expect(attr(tagWithId(html, id), 'aria-invalid')).toBeUndefined()
        expect(attr(tagWithId(html, id), 'aria-describedby')).toBeUndefined()
      }
      expect(html).toContain('>1 field needs attention. Check the messages below.<')
    })
  })

  describe('Scenario: Nothing is flagged while I am still filling in the form @AC-4', () => {
    it('Then no field error and no summary box is shown while there are no errors, filled or not', () => {
      for (const html of [render(empty, {}), render({ ...empty, firstName: 'Jane' }, {})]) {
        expect(count(html, 'role="alert"')).toBe(0)
        expect(count(html, 'aria-invalid')).toBe(0)
        expect(count(html, '-error"')).toBe(0)
        expect(attr(tagWithId(html, 'phone'), 'aria-describedby')).toBe('phone-hint')
      }
    })

    it('And no browser validation bubble appears: the form is noValidate', () => {
      const html = render(empty, {})
      const form = html.slice(html.indexOf('<form '), html.indexOf('>', html.indexOf('<form ')) + 1)
      expect(form).toContain(' noValidate=""')
    })
  })
})
