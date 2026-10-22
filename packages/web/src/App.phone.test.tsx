import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'
import { palette, contrastPairs } from './palette.js'
import { phoneMessage } from './phone.js'
import { initialState, type FormState } from './reducer.js'

// ST-8 / SCR-1 — how the phone field looks when flagged, fixed and saved. Rendered to static
// markup from a given reducer state; the browser-level checks live in e2e/.
const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '555-0132' }
const render = (state: FormState) => renderToStaticMarkup(<App initial={state} />)

function openingTag(html: string, id: string): string {
  const at = html.indexOf(` id="${id}"`)
  expect(at, `element #${id}`).toBeGreaterThan(-1)
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

const attr = (tag: string, name: string): string | undefined => {
  const at = tag.indexOf(` ${name}="`)
  if (at === -1) return undefined
  const from = at + name.length + 3
  return tag.slice(from, tag.indexOf('"', from))
}

const classes = (tag: string) => (attr(tag, 'class') ?? '').split(' ')

describe('Feature: Enter a US phone number and be told exactly when it is wrong', () => {
  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2', () => {
    const html = render({ ...initialState, values, errors: { phone: phoneMessage }, attempted: true })
    const phone = openingTag(html, 'phone')

    it('Then the message appears directly under "Phone number"', () => {
      const message = openingTag(html, 'phone-error')
      expect(html).toContain(`${phone}${message}${phoneMessage}</p>`)
      expect(html.indexOf('>Phone number</label>')).toBeLessThan(html.indexOf(phone))
    })

    it('and is tied to the field for screen readers, error first, then the hint', () => {
      expect(attr(phone, 'aria-invalid')).toBe('true')
      expect(attr(phone, 'aria-describedby')).toBe('phone-error phone-hint')
    })

    it('And the phone field has a red border, in a palette colour that passes contrast', () => {
      expect(classes(phone)).toContain('border-danger')
      expect(classes(phone)).not.toContain('border-edge')
      expect(classes(openingTag(html, 'phone-error'))).toContain('text-danger')
      expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'surface', min: 4.5 })
      expect(palette.danger).toBeDefined()
    })

    it('And no confirmation is shown', () => {
      expect(html).not.toContain('registration-confirmation')
      expect(html).not.toContain('role="status"')
      expect(html).toContain('<form ')
    })

    it('the other fields stay unflagged', () => {
      for (const id of ['firstName', 'lastName', 'email']) {
        expect(openingTag(html, id)).not.toContain('aria-invalid')
        expect(classes(openingTag(html, id))).toContain('border-edge')
        expect(html).not.toContain(`id="${id}-error"`)
      }
    })

    it('renders a server-sent message verbatim on the field it names', () => {
      const server = render({ ...initialState, values, errors: { email: 'Server <says> no.' }, attempted: true })
      expect(server).toContain(`${openingTag(server, 'email-error')}Server &lt;says&gt; no.</p>`)
      expect(attr(openingTag(server, 'email'), 'aria-describedby')).toBe('email-error')
    })
  })

  describe('Scenario: The phone message clears once the number is fixed @AC-7', () => {
    it('Then the phone message and the red border are gone', () => {
      const html = render({ ...initialState, values: { ...values, phone: '(415) 555-0132' }, attempted: true })
      const phone = openingTag(html, 'phone')
      expect(html).not.toContain('phone-error')
      expect(phone).not.toContain('aria-invalid')
      expect(classes(phone)).toContain('border-edge')
      expect(classes(phone)).not.toContain('border-danger')
      expect(attr(phone, 'aria-describedby')).toBe('phone-hint')
    })
  })

  describe('Scenario: Nothing is flagged while I am still typing @AC-7', () => {
    it('Then no phone message is shown', () => {
      const html = render({ ...initialState, values: { ...initialState.values, phone: '555' } })
      expect(html).not.toContain('-error')
      expect(html).not.toContain('aria-invalid')
      expect(attr(openingTag(html, 'phone'), 'value')).toBe('555')
    })
  })

  describe('Scenario Outline: Common ways of writing a US number are accepted @AC-1', () => {
    it('Then I see the confirmation in place of the form', () => {
      const html = render({ ...initialState, saved: 'Jane', attempted: true })
      const confirmation = openingTag(html, 'registration-confirmation')
      expect(attr(confirmation, 'role')).toBe('status')
      expect(html).toContain(`${confirmation}Thank you, Jane. You are registered.</p>`)
      expect(html).not.toContain('<form ')
      expect(html).not.toContain('<input ')
    })
  })

  describe('submitting and failed saves', () => {
    it('Submit stays focusable while a save is in flight and says so', () => {
      const html = render({ ...initialState, values, submitting: true, attempted: true })
      const button = html.slice(html.indexOf('<button'), html.indexOf('>', html.indexOf('<button')) + 1)
      expect(button).not.toContain('disabled=""')
      expect(attr(button, 'aria-disabled')).toBe('true')
    })

    it('a failed save shows an alert and keeps every value', () => {
      const html = render({ ...initialState, values, saveFailed: true, attempted: true })
      const alert = openingTag(html, 'save-failed')
      expect(attr(alert, 'role')).toBe('alert')
      expect(html).toContain(`${alert}Sorry, your registration could not be saved. Please try again.</p>`)
      expect(attr(openingTag(html, 'firstName'), 'value')).toBe('Jane')
      expect(attr(openingTag(html, 'phone'), 'value')).toBe('555-0132')
    })
  })
})
