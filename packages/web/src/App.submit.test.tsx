import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'
import { contrastPairs, contrastRatio, palette } from './palette.js'
import { initialState, reducer, type FormState } from './reducer.js'

// ST-11 / SCR-1 — the screen after the API refused a submission. Rendered to static markup
// from the reducer's states (the web package has no DOM test environment).
const values = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const submitting = reducer({ ...initialState, values }, { type: 'submit' })
const invalid = reducer(submitting, { type: 'failed', errors: { phone: phoneMessage } })

const render = (state: FormState) => renderToStaticMarkup(<App initial={state} />)
const count = (html: string, needle: string) => html.split(needle).length - 1

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

describe('Feature: Keep bad data out even when the screen is bypassed', () => {
  describe('Scenario: The screen shows the API’s field errors next to my fields @AC-6', () => {
    const html = render(invalid)

    it('Then the phone message appears directly under the "Phone number" input, verbatim', () => {
      const input = tagWithId(html, 'phone')
      const error = tagWithId(html, 'phone-error')
      expect(html).toContain(`${input}${error}${phoneMessage}</p>`)
      expect(html.indexOf(error)).toBeLessThan(html.indexOf(tagWithId(html, 'phone-hint')))
      expect(html.indexOf(error)).toBeGreaterThan(html.indexOf('>Phone number</label>'))
    })

    it('as a field error tied to the phone input for screen readers, not an alert', () => {
      const input = tagWithId(html, 'phone')
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect(attr(input, 'aria-describedby')).toBe('phone-error phone-hint')
      expect(tagWithId(html, 'phone-error')).not.toContain('role=')
      expect(attr(input, 'class')?.split(' ')).toContain('border-danger')
      expect(attr(tagWithId(html, 'phone-error'), 'class')?.split(' ')).toContain('text-danger')
    })

    it('no other field is flagged', () => {
      for (const id of ['firstName', 'lastName', 'email']) {
        expect(attr(tagWithId(html, id), 'aria-invalid')).toBeUndefined()
        expect(html).not.toContain(`id="${id}-error"`)
      }
      expect(count(html, 'aria-invalid')).toBe(1)
      expect(attr(tagWithId(html, 'firstName'), 'aria-describedby')).toBeUndefined()
    })

    it('And all four fields still hold what I typed', () => {
      for (const [id, value] of Object.entries(values)) expect(attr(tagWithId(html, id), 'value')).toBe(value)
    })

    it('But neither the save-failed alert nor the confirmation is shown', () => {
      expect(count(html, 'role="alert"')).toBe(0)
      expect(count(html, 'role="status"')).toBe(0)
      expect(html).not.toContain('id="save-failed"')
      expect(html).not.toContain('id="confirmation"')
    })

    it('a server message is rendered as text, never as markup', () => {
      const markup = render(reducer(submitting, { type: 'failed', errors: { email: '<b>bad</b> & "x"' } }))
      expect(markup).toContain('&lt;b&gt;bad&lt;/b&gt; &amp; &quot;x&quot;</p>')
      expect(markup).not.toContain('<b>')
    })

    it('a 400 with fields {} flags no field and shows no alert', () => {
      const markup = render(reducer(submitting, { type: 'failed', errors: {} }))
      expect(count(markup, 'aria-invalid')).toBe(0)
      expect(count(markup, '-error"')).toBe(0)
      expect(count(markup, 'role="alert"')).toBe(0)
    })

    it('several flagged fields each carry their own message under their own input', () => {
      const markup = render(reducer(submitting, { type: 'failed', errors: { email: 'Enter a valid email address.', phone: phoneMessage } }))
      expect(markup).toContain(`${tagWithId(markup, 'email')}${tagWithId(markup, 'email-error')}Enter a valid email address.</p>`)
      expect(attr(tagWithId(markup, 'email'), 'aria-describedby')).toBe('email-error')
      expect(markup).toContain(`${tagWithId(markup, 'phone-error')}${phoneMessage}</p>`)
    })

    it('while submitting, Submit is announced as unavailable but stays focusable — never natively disabled', () => {
      const markup = render(submitting)
      const button = markup.slice(markup.indexOf('<button'), markup.indexOf('>', markup.indexOf('<button')) + 1)
      expect(attr(button, 'aria-disabled')).toBe('true')
      expect(button).not.toContain(' disabled=""')
      expect(attr(button, 'type')).toBe('submit')
      expect(count(markup, 'aria-invalid')).toBe(0)
    })

    it('Submit is not marked unavailable once the API has answered', () => {
      expect(html.slice(html.indexOf('<button'))).not.toContain('aria-disabled')
    })

    it('a failed save is the one alert, and a 201 the one confirmation — the states AC-6 must not reach', () => {
      const failed = render(reducer(submitting, { type: 'saveFailed' }))
      expect(count(failed, 'role="alert"')).toBe(1)
      expect(tagWithId(failed, 'save-failed')).toContain('role="alert"')
      expect(count(failed, 'aria-invalid')).toBe(0)
      for (const [id, value] of Object.entries(values)) expect(attr(tagWithId(failed, id), 'value')).toBe(value)
      const saved = render(reducer(submitting, { type: 'submitted', firstName: 'Jane' }))
      expect(count(saved, 'role="status"')).toBe(1)
      expect(tagWithId(saved, 'confirmation')).toContain('role="status"')
      expect(saved).toContain('Jane')
      expect(count(saved, 'role="alert"')).toBe(0)
    })

    it('the error colour is a palette token that reads on the card, as text and as the input border', () => {
      expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'surface', min: 4.5 })
      expect(contrastRatio(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5)
    })

    it('the opening screen still renders with no state passed in', () => {
      const opening = renderToStaticMarkup(<App />)
      expect(count(opening, 'aria-invalid')).toBe(0)
      expect(count(opening, 'role="alert"')).toBe(0)
    })
  })
})
