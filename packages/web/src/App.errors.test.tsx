import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RegistrationForm } from './App.js'
import { contrastPairs, contrastRatio, palette } from './palette.js'
import { initialState, type FormState } from './reducer.js'

// ST-11 / SCR-1 — the screen after the API refuses a submission with field errors (AC-6).
// Rendered to static markup (no DOM test environment); the submitter's focus and request
// handling are covered in submit.test.ts.
const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const typed = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const noop = () => undefined

function render(state: FormState): string {
  return renderToStaticMarkup(<RegistrationForm state={state} onChange={noop} onSubmit={noop} />)
}

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

const refused: FormState = { ...initialState, values: typed, errors: { phone: phoneMessage } }

describe('Feature: Keep bad data out even when the screen is bypassed', () => {
  describe("Scenario: The screen shows the API's field errors next to my fields @AC-6", () => {
    const html = render(refused)

    it('Then the phone message appears directly under "Phone number", verbatim, as that field’s error', () => {
      const error = tagWithId(html, 'phone-error')
      expect(html).toContain(`${error}${phoneMessage}</p>`)
      const phone = tagWithId(html, 'phone')
      expect(html.indexOf(error)).toBe(html.indexOf(phone) + phone.length)
      expect(html.indexOf(error)).toBeLessThan(html.indexOf(tagWithId(html, 'phone-hint')))
      expect(attr(phone, 'aria-invalid')).toBe('true')
      expect(attr(phone, 'aria-describedby')).toBe('phone-error phone-hint')
      expect((attr(error, 'class') ?? '').split(' ')).toContain('text-danger')
    })

    it('And all four fields still hold what I typed', () => {
      for (const [id, value] of Object.entries(typed)) expect(attr(tagWithId(html, id), 'value')).toBe(value)
    })

    it('But neither the save-failed alert nor the confirmation is shown', () => {
      expect(html).not.toContain('role="alert"')
      expect(html).not.toContain('role="status"')
      expect(html).not.toContain('aria-live')
      expect(html.split('<form').length - 1).toBe(1)
      expect(html.split('<input').length - 1).toBe(4)
    })

    it('flags only the field the API named', () => {
      for (const id of ['firstName', 'lastName', 'email']) {
        const input = tagWithId(html, id)
        expect(input).not.toContain('aria-invalid')
        expect(attr(input, 'aria-describedby')).toBeUndefined()
        expect(html).not.toContain(`id="${id}-error"`)
      }
    })
  })

  it('a field without a hint is described by its error alone', () => {
    const html = render({ ...refused, errors: { email: 'Enter a valid email address.' } })
    const email = tagWithId(html, 'email')
    expect(attr(email, 'aria-invalid')).toBe('true')
    expect(attr(email, 'aria-describedby')).toBe('email-error')
    expect(html).toContain(`${tagWithId(html, 'email-error')}Enter a valid email address.</p>`)
    expect(attr(tagWithId(html, 'phone'), 'aria-describedby')).toBe('phone-hint')
  })

  it('renders server-sent text as text, never markup', () => {
    const html = render({ ...refused, errors: { phone: '<b>bold</b> & "quoted"' } })
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; ')
    expect(html).not.toContain('<b>')
  })

  it('the error colour is a palette token that reads at 4.5:1 on the card', () => {
    expect(palette).toHaveProperty('danger')
    const pair = contrastPairs.find((p) => p.fg === ('danger' as never) && p.bg === 'surface')
    expect(pair?.min).toBe(4.5)
    expect(contrastRatio((palette as Record<string, string>).danger, palette.surface)).toBeGreaterThanOrEqual(4.5)
  })
})
