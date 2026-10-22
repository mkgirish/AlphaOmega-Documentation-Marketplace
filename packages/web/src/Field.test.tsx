import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Field } from './Field.js'
import { fields } from './fields.js'
import { contrastPairs, contrastRatio, palette } from './palette.js'

// ST-8 / SCR-1 — the phone field as Submit leaves it: the message directly under the input,
// tied to it for screen readers, and a red border (AC-2, AC-3, AC-7).
const message = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const phone = fields[3]
const noop = () => undefined

const render = (error?: string) => renderToStaticMarkup(<Field field={phone} value="(555) 013-2" error={error} onChange={noop} />)

const inputTag = (html: string) => html.slice(html.indexOf('<input '), html.indexOf('/>', html.indexOf('<input ')) + 2)
function classes(tag: string): string[] {
  const from = tag.indexOf(' class="') + 8
  return tag.slice(from, tag.indexOf('"', from)).split(' ')
}

describe('Feature: Enter a US phone number and be told exactly when it is wrong — the phone field', () => {
  describe('Scenario Outline: Numbers that are not a 10-digit US number are rejected @AC-2', () => {
    const html = render(message)
    const input = inputTag(html)

    it('Then the message appears directly under "Phone number"', () => {
      expect(html).toContain(`>Phone number</label>${input}<p id="phone-error"`)
      const error = html.slice(html.indexOf('<p id="phone-error"'), html.indexOf('</p>', html.indexOf('<p id="phone-error"')) + 4)
      expect(error.endsWith(`>${message}</p>`)).toBe(true)
      expect(html.indexOf(error)).toBeLessThan(html.indexOf('id="phone-hint"'))
    })

    it('And the message is announced when it appears, in the error colour', () => {
      const error = html.slice(html.indexOf('<p id="phone-error"'), html.indexOf('>', html.indexOf('<p id="phone-error"')) + 1)
      expect(error).toContain(' role="alert"')
      expect(classes(error)).toContain('text-danger')
    })

    it('And the message is tied to the input and the input is marked invalid', () => {
      expect(input).toContain(' aria-invalid="true"')
      expect(input).toContain(' aria-describedby="phone-error phone-hint"')
      expect(input).toContain(' value="(555) 013-2"')
    })

    it('And the phone field has a red border', () => {
      expect(classes(input)).toContain('border-danger')
      expect(classes(input)).not.toContain('border-edge')
    })

    it('And the red is a palette token readable on the card', () => {
      expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'surface', min: 4.5 })
      expect(contrastRatio(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('Scenario: The phone message clears once the number is fixed @AC-7', () => {
    const html = render(undefined)
    const input = inputTag(html)

    it('Then the phone message and the red border are gone', () => {
      expect(html).not.toContain('phone-error')
      expect(html).not.toContain(message)
      expect(input).not.toContain('aria-invalid')
      expect(input).toContain(' aria-describedby="phone-hint"')
      expect(classes(input)).toContain('border-edge')
      expect(classes(input)).not.toContain('border-danger')
    })
  })

  it('a field without a hint is described by its error alone', () => {
    const html = renderToStaticMarkup(<Field field={fields[0]} value="" error="Check this field." onChange={noop} />)
    expect(inputTag(html)).toContain(' aria-describedby="firstName-error"')
    expect(html).toContain('<p id="firstName-error"')
    expect(html).toContain('>Check this field.</p>')
  })
})
