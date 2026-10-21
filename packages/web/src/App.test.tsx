import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'

// ST-1 / SCR-1 — the registration screen as first opened at the lobby kiosk. Rendered to
// static markup (the web package has no DOM test environment); the browser-level checks
// live in e2e/.
const html = renderToStaticMarkup(<App />)

const count = (needle: string) => html.split(needle).length - 1

/** The opening tag of the element carrying the given id. */
function tagWithId(id: string): string {
  const at = html.indexOf(` id="${id}"`)
  expect(at, `element #${id}`).toBeGreaterThan(-1)
  const start = html.lastIndexOf('<', at)
  return html.slice(start, html.indexOf('>', at) + 1)
}

/** The opening tags of every element of the given name, in document order. */
function tags(name: string): string[] {
  return html
    .split(`<${name} `)
    .slice(1)
    .map((rest) => `<${name} ${rest.slice(0, rest.indexOf('>') + 1)}`)
}

const attr = (tag: string, name: string): string | undefined => {
  const at = tag.indexOf(` ${name}="`)
  if (at === -1) return undefined
  const from = at + name.length + 3
  return tag.slice(from, tag.indexOf('"', from))
}

const fields = [
  { id: 'firstName', label: 'First name', type: 'text' },
  { id: 'lastName', label: 'Last name', type: 'text' },
  { id: 'email', label: 'Email', type: 'email' },
  { id: 'phone', label: 'Phone number', type: 'tel' },
] as const

describe('Feature: Open the registration screen at the lobby kiosk from one container', () => {
  describe('Scenario: One container serves the screen with nothing else running @AC-1', () => {
    it('Then the page shows the heading "Visitor registration"', () => {
      expect(count('<h1')).toBe(1)
      expect(html).toContain(`${tagWithId('registration-title')}Visitor registration</h1>`)
    })
  })

  describe('Scenario: The form shows exactly the four visitor fields @AC-2', () => {
    it('reads "Please register. All fields are required."', () => {
      expect(html).toContain('>Please register. All fields are required.</p>')
    })

    it('Then I see the inputs First name, Last name, Email and Phone number, each marked required', () => {
      const inputs = tags('input')
      expect(inputs).toHaveLength(4)
      expect(count('<select')).toBe(0)
      expect(count('<textarea')).toBe(0)
      inputs.forEach((input, index) => {
        const field = fields[index]
        expect(attr(input, 'id')).toBe(field.id)
        expect(attr(input, 'name')).toBe(field.id)
        expect(attr(input, 'type')).toBe(field.type)
        expect(input).toContain(' required=""')
        expect(html).toContain(`<label for="${field.id}"`)
        expect(html).toContain(`>${field.label}</label>`)
      })
      expect(count('<label')).toBe(4)
    })

    it('And I see the phone hint under the phone input, tied to it for screen readers', () => {
      const hint = tagWithId('phone-hint')
      expect(html).toContain(`${hint}10-digit US number, e.g. (415) 555-0132</p>`)
      expect(attr(tagWithId('phone'), 'aria-describedby')).toBe('phone-hint')
      expect(html.indexOf(hint)).toBeGreaterThan(html.indexOf(tagWithId('phone')))
      expect(attr(tagWithId('phone'), 'inputMode')).toBe('tel')
    })

    it('And I see exactly one button, "Submit"', () => {
      const buttons = tags('button')
      expect(buttons).toHaveLength(1)
      expect(attr(buttons[0], 'type')).toBe('submit')
      expect(buttons[0]).not.toContain('disabled')
      expect(html).toContain(`${buttons[0]}Submit</button>`)
      expect(count('type="submit"')).toBe(1)
    })
  })

  describe('Scenario: There is nowhere else to go @AC-3', () => {
    it('Then I find no links, menu or navigation — the page is the one card and nothing else', () => {
      expect(html.startsWith('<main ')).toBe(true)
      expect(html.indexOf(tagWithId('registration-card'))).toBe(html.indexOf('>') + 1)
      expect(count('<a ')).toBe(0)
      expect(count('<a>')).toBe(0)
      expect(count('<nav')).toBe(0)
      expect(count('<menu')).toBe(0)
      expect(count('href=')).toBe(0)
      expect(count('role="navigation"')).toBe(0)
      expect(count('role="menu')).toBe(0)
      expect(count('role="link"')).toBe(0)
    })
  })

  describe('Scenario: The first visitor sees an empty, calm form @AC-4', () => {
    it('Then all four inputs are blank', () => {
      expect(tags('input')).toHaveLength(4)
      for (const input of tags('input')) expect(attr(input, 'value')).toBe('')
    })

    it('And no field error, summary box or alert is shown', () => {
      expect(count('role="alert"')).toBe(0)
      expect(count('role="status"')).toBe(0)
      expect(count('aria-invalid')).toBe(0)
      expect(count('aria-live')).toBe(0)
      expect(count('aria-errormessage')).toBe(0)
      expect(count('<p ')).toBe(2)
      expect(tagWithId('registration-intro')).toContain('<p ')
      expect(tagWithId('phone-hint')).toContain('<p ')
      for (const input of tags('input')) expect(input).not.toContain('error')
    })

    it('And the cursor is in "First name" — the only autofocused control', () => {
      expect(tagWithId('firstName')).toContain(' autofocus=""')
      expect(count('autofocus')).toBe(1)
    })
  })

  describe('Scenario Outline: The form fits kiosk, tablet and narrow screens @AC-5', () => {
    it('the form card is full width but never wider than 480 pixels', () => {
      const card = tagWithId('registration-card')
      const classes = (attr(card, 'class') ?? '').split(' ')
      expect(classes).toContain('w-full')
      expect(classes).toContain('max-w-[480px]')
    })

    it('every input and the button stretch to the card, never a fixed width that could overflow', () => {
      for (const control of [...tags('input'), ...tags('button')]) {
        const classes = (attr(control, 'class') ?? '').split(' ')
        expect(classes).toContain('w-full')
        expect(classes.some((name) => name.startsWith('min-w-[') || name.startsWith('w-['))).toBe(false)
        expect(control).not.toContain('size=')
      }
    })

    it('every control is a comfortable touch target with a visible focus ring', () => {
      for (const control of [...tags('input'), ...tags('button')]) {
        const classes = (attr(control, 'class') ?? '').split(' ')
        expect(classes.some((name) => name === 'min-h-11' || name === 'min-h-12')).toBe(true)
        expect(classes).toContain('focus-visible:outline-3')
        expect(classes).toContain('focus-visible:outline-focus')
      }
    })
  })

  describe('Scenario: A keyboard-only visitor can reach every control in order @AC-6', () => {
    it('Tab moves First name, Last name, Email, Phone number, Submit — document order, no tabindex overrides', () => {
      const order = [...fields.map((field) => html.indexOf(tagWithId(field.id))), html.indexOf('<button')]
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(count('tabindex')).toBe(0)
      expect(count('tabIndex')).toBe(0)
    })

    it('the page has one main landmark, a labelled form and lang-independent markup with no inline style', () => {
      expect(count('<main')).toBe(1)
      expect(attr(tags('form')[0], 'aria-labelledby')).toBe(attr(tagWithId('registration-title'), 'id'))
      expect(count('style=')).toBe(0)
    })
  })

  describe('kiosk hygiene', () => {
    it('the form never shows native validation bubbles and never offers a previous visitor’s values', () => {
      const form = tags('form')[0]
      expect(form).toContain('noValidate=""')
      expect(attr(form, 'autoComplete')).toBe('off')
      for (const input of tags('input')) expect(attr(input, 'autoComplete')).toBe('off')
    })

    it('the form posts nowhere: no action or method that could put values in the URL', () => {
      const form = tags('form')[0]
      expect(form).toBeDefined()
      expect(form).not.toContain('action=')
      expect(form).not.toContain('method=')
    })
  })
})
