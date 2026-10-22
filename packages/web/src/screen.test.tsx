import { readFileSync } from 'node:fs'
import { messages } from '@app/shared'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { contrastPairs, contrastRatio, palette } from './palette.js'
import { initialState, type FormState } from './reducer.js'
import { RegistrationScreen } from './screen.js'

// ST-9 / SCR-1 — the screen in each state the email story touches, rendered to static
// markup (the web package has no DOM test environment).
const noop = () => undefined
const render = (state: FormState) => renderToStaticMarkup(<RegistrationScreen state={state} onChange={noop} onSubmit={noop} />)

const filled = { firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '(415) 555-0132' }
const flagged: FormState = { ...initialState, values: filled, errors: { email: messages.invalidEmail } }

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

const classes = (tag: string) => (attr(tag, 'class') ?? '').split(' ')

describe('Feature: Be told when my email address is not complete — screen', () => {
  describe('Scenario Outline: An incomplete email is flagged @AC-2', () => {
    const html = render(flagged)
    const input = tagWithId(html, 'email')

    it('Then the email message appears directly under "Email"', () => {
      const message = tagWithId(html, 'email-error')
      expect(html).toContain(`${input}${message}${messages.invalidEmail}</p>`)
      expect(html.indexOf('>Email</label>')).toBeLessThan(html.indexOf(input))
    })

    it('and screen readers hear it as the field’s error', () => {
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect(attr(input, 'aria-describedby')).toBe('email-error')
    })

    it('And the email field has a red border', () => {
      expect(classes(input)).toContain('border-danger')
      expect(classes(input)).not.toContain('border-edge')
      expect(classes(tagWithId(html, 'email-error'))).toContain('text-danger')
    })

    it('And no confirmation is shown, and only email is flagged', () => {
      expect(html).not.toContain('registration-confirmation')
      expect(html).not.toContain('role="status"')
      expect(html.split('aria-invalid').length - 1).toBe(1)
      expect(attr(tagWithId(html, 'firstName'), 'aria-invalid')).toBeUndefined()
      expect(classes(tagWithId(html, 'firstName'))).toContain('border-edge')
    })

    it('keeps what the visitor typed', () => {
      expect(attr(input, 'value')).toBe('jane@')
    })
  })

  describe('Scenario: The email message clears once the address is fixed @AC-4', () => {
    it('Then the email message and the red border are gone', () => {
      const html = render({ ...flagged, values: { ...filled, email: 'jane@example.com' }, errors: {} })
      expect(html).not.toContain('email-error')
      expect(html).not.toContain('border-danger')
      expect(html).not.toContain('aria-invalid')
      expect(classes(tagWithId(html, 'email'))).toContain('border-edge')
    })
  })

  describe('Scenario: The API applies the same email rule @AC-5', () => {
    it('a message the server sent is shown verbatim under its field', () => {
      const html = render({ ...flagged, errors: { email: 'Sent by the <server> & shown as is.' } })
      expect(html).toContain(`${tagWithId(html, 'email-error')}Sent by the &lt;server&gt; &amp; shown as is.</p>`)
    })

    it('a flagged phone keeps its hint and adds its error to what screen readers hear', () => {
      const html = render({ ...flagged, errors: { phone: 'Phone message.' } })
      expect(attr(tagWithId(html, 'phone'), 'aria-describedby')).toBe('phone-error phone-hint')
      expect(html).toContain(`${tagWithId(html, 'phone')}${tagWithId(html, 'phone-error')}Phone message.</p>`)
    })
  })

  describe('Scenario: A complete email is accepted @AC-1', () => {
    it('Then I see the confirmation, announced politely', () => {
      const html = render({ ...initialState, saved: 'Jane' })
      const confirmation = tagWithId(html, 'registration-confirmation')
      expect(attr(confirmation, 'role')).toBe('status')
      expect(html).toContain(`${confirmation}Thank you, Jane. You are registered.</p>`)
      expect(html).not.toContain('aria-invalid')
    })
  })

  describe('while saving and after a failed save', () => {
    it('Submit stays focusable while the request is in flight — aria-disabled, never native disabled', () => {
      const button = renderToStaticMarkup(
        <RegistrationScreen state={{ ...flagged, errors: {}, submitting: true }} onChange={noop} onSubmit={noop} />,
      )
        .split('<button ')[1]
        .split('>')[0]
      expect(button).toContain('aria-disabled="true"')
      expect(button).not.toContain(' disabled')
    })

    it('a failed save is an alert and keeps the values', () => {
      const html = render({ ...flagged, errors: {}, saveFailed: true })
      const alert = tagWithId(html, 'registration-failed')
      expect(attr(alert, 'role')).toBe('alert')
      expect(html).toContain(`${alert}We could not save your registration. Please try again.</p>`)
      expect(attr(tagWithId(html, 'email'), 'value')).toBe('jane@')
    })
  })

  describe('the red border is on the palette and readable', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

    it('danger is a declared token checked as text on the card at 4.5:1 and as a border at 3:1', () => {
      expect(css).toContain(`--color-danger: ${palette.danger};`)
      expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'surface', min: 4.5 })
      expect(contrastRatio(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(palette.danger, palette.canvas)).toBeGreaterThanOrEqual(3)
    })
  })
})
