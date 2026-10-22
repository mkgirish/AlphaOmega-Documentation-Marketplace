import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RegistrationScreen } from './Screen.js'
import { initialState, type FieldErrors, type FormState } from './reducer.js'

// ST-3 / SCR-1 — the screen after a Submit that missed fields, rendered to static markup.
const messages = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter an email like name@example.com.',
  phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.',
} as const

const labels = { firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone number' } as const

const render = (state: FormState) =>
  renderToStaticMarkup(<RegistrationScreen state={state} onChange={() => undefined} onSubmit={() => undefined} onReset={() => undefined} />)

const failed = (errors: FieldErrors, values: FormState['values'] = initialState.values): FormState => ({
  ...initialState,
  blocked: true,
  status: 'invalid',
  values,
  errors,
})

/** The opening tag of the element carrying the given id. */
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

const count = (html: string, needle: string) => html.split(needle).length - 1

describe('Feature: Be stopped when I leave a field empty', () => {
  describe('Scenario: Each empty field says what it needs @AC-3', () => {
    const html = render(failed(messages))

    it.each(Object.keys(messages) as (keyof typeof messages)[])('Then the message for %s appears directly under its input', (field) => {
      const input = tagWithId(html, field)
      const error = tagWithId(html, `${field}-error`)
      expect(html).toContain(`${error}${messages[field]}</p>`)
      expect(html).toContain(`>${labels[field]}</label>`)
      expect(html.indexOf(error)).toBeGreaterThan(html.indexOf(input))
      // Nothing else sits between this input (and its hint) and the next field.
      const nextInput = html.indexOf('<input', html.indexOf(input) + 1)
      expect(nextInput === -1 || html.indexOf(error) < nextInput).toBe(true)
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect((attr(input, 'aria-describedby') ?? '').split(' ')).toContain(`${field}-error`)
    })

    it('the phone keeps its hint described alongside its error', () => {
      expect(attr(tagWithId(html, 'phone'), 'aria-describedby')).toBe('phone-hint phone-error')
    })

    it('And a summary box reads "4 fields need attention. Check the messages below." before the fields', () => {
      const summary = tagWithId(html, 'error-summary')
      expect(attr(summary, 'role')).toBe('alert')
      expect(html).toContain(`${summary}4 fields need attention. Check the messages below.</div>`)
      expect(count(html, 'role="alert"')).toBe(1)
      expect(html.indexOf(summary)).toBeLessThan(html.indexOf(tagWithId(html, 'firstName')))
    })

    it('flags only the fields that missed, and counts them', () => {
      const one = render(
        failed({ phone: messages.phone }, { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' }),
      )
      expect(one).toContain('>1 field needs attention. Check the messages below.</div>')
      expect(count(one, 'aria-invalid="true"')).toBe(1)
      expect(attr(tagWithId(one, 'phone'), 'aria-invalid')).toBe('true')
      for (const field of ['firstName', 'lastName', 'email'] as const) {
        expect(one).not.toContain(`id="${field}-error"`)
        expect(attr(tagWithId(one, field), 'aria-invalid')).toBeUndefined()
        expect(attr(tagWithId(one, field), 'aria-describedby')).toBeUndefined()
      }
      expect(count(one, messages.firstName)).toBe(0)
    })

    it('the screen holds no autofocus that would pull focus back to First name after a re-render', () => {
      expect(count(html, 'autofocus')).toBe(1)
      expect(tagWithId(html, 'firstName')).toContain(' autofocus=""')
    })
  })

  describe('Scenario: Nothing is flagged while I am still filling in the form @AC-4', () => {
    it('Then no field error and no summary box is shown, and the browser bubbles are off', () => {
      const html = render({ ...initialState, values: { firstName: 'J', lastName: '', email: '', phone: '' } })
      expect(count(html, 'role="alert"')).toBe(0)
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(count(html, '-error"')).toBe(0)
      expect(html).not.toContain('need')
      expect(html).toContain('noValidate=""')
    })
  })

  describe('Scenario: What I typed is kept when I missed a field @AC-5', () => {
    it('Then "First name", "Last name" and "Email" still hold what I typed', () => {
      const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '' }
      const html = render(failed({ phone: messages.phone }, values))
      expect(attr(tagWithId(html, 'firstName'), 'value')).toBe('Jane')
      expect(attr(tagWithId(html, 'lastName'), 'value')).toBe('Doe')
      expect(attr(tagWithId(html, 'email'), 'value')).toBe('jane.doe@example.com')
      expect(attr(tagWithId(html, 'phone'), 'value')).toBe('')
    })
  })

  describe('Scenario Outline: A missing field stops the registration @AC-1', () => {
    it('Then no confirmation is shown', () => {
      const html = render(failed({ email: messages.email }))
      expect(count(html, 'role="status"')).toBe(0)
      expect(html.toLowerCase()).not.toContain('thank')
      expect(html.toLowerCase()).not.toContain('registered')
    })
  })
})
