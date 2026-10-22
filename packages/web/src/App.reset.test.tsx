import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'
import { copy } from './copy.js'
import { initialState, reducer, type FieldErrors, type FormState } from './reducer.js'

// ST-5 / SCR-1 — the confirmation and the form it hands back, rendered to static markup in
// each state the story touches. Focus, network and storage are proven live in
// kiosk.browser.test.ts.

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const traces = ['Jane', 'Doe', 'jane.doe@example.com', '4155550132']
const phoneError = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'

function filled(): FormState {
  let state = initialState
  for (const [field, value] of Object.entries(jane)) state = reducer(state, { type: 'change', field: field as keyof typeof jane, value })
  return state
}
const submitting = () => reducer(filled(), { type: 'submit' })
const invalid = (errors: FieldErrors) => reducer(submitting(), { type: 'failed', errors })
const confirmed = () => reducer(submitting(), { type: 'submitted', firstName: 'Jane' })
const reset = () => reducer(confirmed(), { type: 'reset' })

const render = (state: FormState) => renderToStaticMarkup(<App initial={state} />)
const count = (html: string, needle: string) => html.split(needle).length - 1

/** The opening tag of the element carrying the given id. */
function tagWithId(html: string, id: string): string {
  const at = html.indexOf(` id="${id}"`)
  expect(at, `element #${id}`).toBeGreaterThan(-1)
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
}

/** The opening tags of every element of the given name, in document order. */
function tags(html: string, name: string): string[] {
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

describe('Feature: Clear the kiosk for the next visitor', () => {
  it('the copy matches the story character for character', () => {
    expect(copy.thankYou('Jane')).toBe('Thank you, Jane!')
    expect(copy.registerAnother).toBe('Register another visitor')
    expect(copy.formCleared).toBe('Form cleared for the next visitor')
  })

  describe('Scenario: The confirmation offers one way forward @story:ST-5 @criterion:AC-1', () => {
    const html = render(confirmed())

    it('Given I have just registered as "Jane", Then the heading reads "Thank you, Jane!" and takes focus programmatically', () => {
      const heading = tagWithId(html, 'confirmation-title')
      expect(heading.startsWith('<h1 ')).toBe(true)
      expect(attr(heading, 'tabindex')).toBe('-1')
      expect(html).toContain(`${heading}Thank you, Jane!</h1>`)
      expect(count(html, '<h1')).toBe(1)
    })

    it('When I press Tab once from the heading, Then focus is on "Register another visitor"', () => {
      const heading = html.indexOf(tagWithId(html, 'confirmation-title'))
      const button = html.indexOf('<button ')
      expect(button).toBeGreaterThan(heading)
      const between = html.slice(heading, button)
      for (const focusable of ['<input', '<a ', '<select', '<textarea', 'tabindex="0"', 'href=']) expect(between).not.toContain(focusable)
      expect(count(html, 'tabindex="0"')).toBe(0)
    })

    it('And it is the only button on the screen', () => {
      const buttons = tags(html, 'button')
      expect(buttons).toHaveLength(1)
      expect(attr(buttons[0], 'type')).toBe('button')
      expect(html).toContain(`${buttons[0]}Register another visitor</button>`)
      expect(count(html, '<form')).toBe(0)
      expect(count(html, '<input')).toBe(0)
      expect(count(html, '<a ')).toBe(0)
    })

    it('the button is a comfortable touch target with a visible focus ring, stretched to the card', () => {
      const classes = (attr(tags(html, 'button')[0], 'class') ?? '').split(' ')
      expect(classes).toContain('w-full')
      expect(classes).toContain('min-h-12')
      expect(classes).toContain('focus-visible:outline-3')
      expect(classes).toContain('focus-visible:outline-focus')
    })

    it('the confirmation shows the first name only — no surname, email or phone', () => {
      for (const trace of traces.slice(1)) expect(html).not.toContain(trace)
    })

    it('greets with no name when the API saved none', () => {
      expect(render(reducer(submitting(), { type: 'submitted' }))).toContain('>Thank you!</h1>')
    })
  })

  describe('Scenario: The form comes back without a page reload @story:ST-5 @criterion:AC-2', () => {
    it('Then the registration form is shown, inside the same card, with the same live region', () => {
      const before = render(confirmed())
      const after = render(reset())
      expect(tagWithId(before, 'registration-card')).toBe(tagWithId(after, 'registration-card'))
      expect(tagWithId(before, 'announcer')).toBe(tagWithId(after, 'announcer'))
      expect(after).toContain('>Visitor registration</h1>')
      expect(count(after, '<form')).toBe(1)
      expect(after).not.toContain('action=')
      expect(after).not.toContain('href=')
    })
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    const html = render(reset())

    it('Then all four inputs are blank', () => {
      const inputs = tags(html, 'input')
      expect(inputs.map((input) => attr(input, 'id'))).toEqual(['firstName', 'lastName', 'email', 'phone'])
      for (const input of inputs) expect(attr(input, 'value')).toBe('')
    })

    it('And no field error, summary box, alert or "Thank you" heading is shown', () => {
      expect(count(html, 'role="alert"')).toBe(0)
      expect(count(html, 'aria-invalid')).toBe(0)
      expect(count(html, 'error-summary')).toBe(0)
      expect(count(html, '-error"')).toBe(0)
      expect(html).not.toContain('Thank you')
      expect(html).not.toContain('confirmation-title')
    })

    it('And the cursor is in "First name"', () => {
      expect(tagWithId(html, 'firstName')).toContain(' autofocus=""')
      expect(count(html, 'autofocus')).toBe(1)
    })

    it('And a screen reader announces "Form cleared for the next visitor"', () => {
      const region = tagWithId(html, 'announcer')
      expect(region.startsWith('<output ')).toBe(true)
      expect(html).toContain(`${region}Form cleared for the next visitor</output>`)
    })

    it('And the Submit button is back, enabled', () => {
      const buttons = tags(html, 'button')
      expect(buttons).toHaveLength(1)
      expect(html).toContain(`${buttons[0]}Submit</button>`)
      expect(buttons[0]).not.toContain('disabled')
    })
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane first pressed Submit with an empty phone and saw its error', () => {
      const html = render(invalid({ phone: phoneError }))
      const phone = tagWithId(html, 'phone')
      expect(attr(phone, 'aria-invalid')).toBe('true')
      expect(attr(phone, 'aria-describedby')).toBe('phone-hint phone-error')
      expect(html).toContain(`${tagWithId(html, 'phone-error')}${phoneError}</p>`)
      const summary = tagWithId(html, 'error-summary')
      expect(attr(summary, 'tabindex')).toBe('-1')
      expect(attr(summary, 'role')).toBe('region')
      expect(attr(summary, 'aria-labelledby')).toBe('error-summary-title')
      expect(html).toContain(`>${phoneError}</li>`)
      expect(attr(tagWithId(html, 'firstName'), 'aria-invalid')).toBeUndefined()
    })

    it('When she activates "Register another visitor" after registering, Then no field error and no summary box is shown', () => {
      const html = render(reset())
      expect(html).not.toContain(phoneError)
      expect(count(html, 'error-summary')).toBe(0)
      expect(count(html, 'aria-invalid')).toBe(0)
    })
  })

  describe('Scenario: The previous visitor’s details leave no trace on the kiosk @story:ST-5 @criterion:AC-4', () => {
    it('Then the reset screen contains none of "Jane", "jane.doe@example.com" or "4155550132"', () => {
      const html = render(reset())
      for (const trace of traces) expect(html).not.toContain(trace)
    })

    it('and the form still refuses native validation bubbles and browser autofill', () => {
      const html = render(reset())
      expect(tags(html, 'form')[0]).toContain('noValidate=""')
      for (const input of tags(html, 'input')) expect(attr(input, 'autoComplete')).toBe('off')
    })
  })
})

describe('SCR-1 states the reset path passes through', () => {
  it('a 400 with no field flagged shows the summary with a general message and flags no field', () => {
    const html = render(invalid({}))
    expect(html).toContain(`>${copy.summaryFallback}</li>`)
    expect(count(html, 'aria-invalid')).toBe(0)
    expect(html).toContain(`${tagWithId(html, 'error-summary-title')}${copy.summaryTitle}</h2>`)
  })

  it('a failed save shows one alert and keeps every value', () => {
    const html = render(reducer(submitting(), { type: 'saveFailed' }))
    expect(count(html, 'role="alert"')).toBe(1)
    expect(html).toContain(`${tagWithId(html, 'save-failed')}${copy.saveFailed}</p>`)
    for (const [field, value] of Object.entries(jane)) expect(attr(tagWithId(html, field), 'value')).toBe(value)
  })

  it('while submitting, Submit stays focusable: aria-disabled and busy, never native disabled', () => {
    const html = render(submitting())
    const button = tags(html, 'button')[0]
    expect(attr(button, 'aria-disabled')).toBe('true')
    expect(button).not.toContain(' disabled=')
    expect(attr(tags(html, 'form')[0], 'aria-busy')).toBe('true')
    for (const input of tags(html, 'input')) expect(input).toContain('readOnly=""')
  })

  it('the opening form has an empty live region and renders as App does by default', () => {
    const html = render(initialState)
    expect(html).toContain(`${tagWithId(html, 'announcer')}</output>`)
    expect(html).toBe(renderToStaticMarkup(<App />))
  })
})
