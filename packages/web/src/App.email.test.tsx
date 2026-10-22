import { messages } from '@app/shared'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'
import { contrastPairs, contrastRatio, palette } from './palette.js'
import { initialState, type FormState } from './reducer.js'

// ST-9 / SCR-1 — how the email message and the red border render. Static markup, as in
// App.test.tsx: the web package has no DOM test environment.
const render = (state: FormState) => renderToStaticMarkup(<App initial={state} />)

const flagged: FormState = {
  ...initialState,
  values: { firstName: 'Jane', lastName: 'Doe', email: 'jane@', phone: '(415) 555-0132' },
  errors: { email: messages.invalidEmail },
}

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

describe('Feature: Be told when my email address is not complete', () => {
  describe('Scenario Outline: An incomplete email is flagged @AC-2', () => {
    const html = render(flagged)
    const input = tagWithId(html, 'email')
    const message = tagWithId(html, 'email-error')

    it('Then the shared email message appears directly under "Email"', () => {
      expect(html).toContain(`${message}${messages.invalidEmail}</p>`)
      const afterInput = html.indexOf(input) + input.length
      expect(html.indexOf(message)).toBe(afterInput)
      expect(html.indexOf('>Email</label>')).toBeLessThan(html.indexOf(input))
      expect(html.indexOf(message)).toBeLessThan(html.indexOf('<label for="phone"'))
    })

    it('And the message is tied to the email input for screen readers', () => {
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect(attr(input, 'aria-describedby')).toBe('email-error')
    })

    it('And the email field has a red border and the message is red, in the palette’s danger colour', () => {
      expect(classes(input)).toContain('border-danger')
      expect(classes(input)).not.toContain('border-edge')
      expect(classes(message)).toContain('text-danger')
    })

    it('And no confirmation is shown and nothing else is flagged', () => {
      expect(html.split('aria-invalid="true"')).toHaveLength(2)
      expect(html).not.toContain('role="status"')
      for (const id of ['firstName', 'lastName', 'phone']) {
        expect(attr(tagWithId(html, id), 'aria-invalid')).toBeUndefined()
        expect(classes(tagWithId(html, id))).toContain('border-edge')
      }
      expect(attr(tagWithId(html, 'phone'), 'aria-describedby')).toBe('phone-hint')
    })

    it('And what was typed stays in the field so it can be fixed', () => {
      expect(attr(input, 'value')).toBe('jane@')
    })

    it('renders whatever message the state carries, verbatim', () => {
      const custom = render({ ...flagged, errors: { email: 'A server-sent <message> & more.' } })
      expect(custom).toContain('>A server-sent &lt;message&gt; &amp; more.</p>')
    })
  })

  describe('Scenario: The email message clears once the address is fixed @AC-4', () => {
    it('Then the email message and the red border are gone', () => {
      const html = render({ ...flagged, values: { ...flagged.values, email: 'jane@example.com' }, errors: {} })
      const input = tagWithId(html, 'email')
      expect(html).not.toContain('id="email-error"')
      expect(html).not.toContain(messages.invalidEmail)
      expect(html).not.toContain('aria-invalid')
      expect(attr(input, 'aria-describedby')).toBeUndefined()
      expect(classes(input)).toContain('border-edge')
      expect(classes(input)).not.toContain('border-danger')
    })

    it('an error key holding no message renders as no error', () => {
      const html = render({ ...flagged, errors: { email: undefined } })
      expect(html).not.toContain('email-error')
      expect(html).not.toContain('aria-invalid')
    })

    it('the screen opens with no message when given no state', () => {
      expect(renderToStaticMarkup(<App />)).toBe(render(initialState))
    })
  })

  describe('the red is a palette token that holds its contrast', () => {
    it('danger text on the card meets 4.5:1 and the danger border meets 3:1 on card and canvas', () => {
      expect(palette).toHaveProperty('danger')
      expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'surface', min: 4.5 })
      expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'canvas', min: 3 })
      expect(contrastRatio(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(palette.danger, palette.canvas)).toBeGreaterThanOrEqual(3)
    })

    it('the danger red is distinct from the ordinary border and the focus ring', () => {
      expect(palette.danger).not.toBe(palette.edge)
      expect(palette.danger).not.toBe(palette.focus)
    })
  })
})
