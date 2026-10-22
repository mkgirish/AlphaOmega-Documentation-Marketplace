import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type FormState } from './reducer.js'
import { RegistrationScreen } from './Screen.js'

// ST-2 / SCR-1 — each state the story adds, rendered to static markup (the web package has
// no DOM test environment). Focus, title, network and axe are checked in a real browser by
// App.browser.test.ts.
const noop = () => undefined
const render = (state: FormState) =>
  renderToStaticMarkup(<RegistrationScreen state={state} onChange={noop} onSubmit={noop} onReset={noop} />)

const jane = { firstName: ' Jane ', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }
const submitting = reducer({ ...initialState, values: jane }, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })

const count = (html: string, needle: string) => html.split(needle).length - 1

function tags(html: string, name: string): string[] {
  return html
    .split(`<${name} `)
    .slice(1)
    .map((rest) => `<${name} ${rest.slice(0, rest.indexOf('>') + 1)}`)
}

function attr(tag: string, name: string): string | undefined {
  const at = tag.indexOf(` ${name}="`)
  if (at === -1) return undefined
  const from = at + name.length + 3
  return tag.slice(from, tag.indexOf('"', from))
}

/** The text of the page with every tag removed. */
function text(html: string): string {
  return html
    .split('<')
    .map((chunk) => chunk.slice(chunk.indexOf('>') + 1))
    .join(' ')
    .split(' ')
    .filter(Boolean)
    .join(' ')
}

describe('Feature: Submit my details and see a confirmation once my visit is saved', () => {
  describe('Scenario: The form waits while my visit is being saved @AC-4', () => {
    const html = render(submitting)

    it('Then the four inputs are read-only and still show my values', () => {
      const inputs = tags(html, 'input')
      expect(inputs).toHaveLength(4)
      expect(inputs.map((input) => attr(input, 'value'))).toEqual([' Jane ', 'Doe', 'jane.doe@example.com', '(415) 555-0132'])
      for (const input of inputs) {
        expect(input.toLowerCase()).toContain(' readonly=""')
        expect(input).not.toContain('disabled')
      }
    })

    it('And the Submit button reads "Submitting…" with a spinner, and stays focusable (no native disabled)', () => {
      const [button] = tags(html, 'button')
      expect(tags(html, 'button')).toHaveLength(1)
      expect(attr(button, 'type')).toBe('submit')
      expect(attr(button, 'aria-disabled')).toBe('true')
      expect(button).not.toContain('disabled=""')
      const spinner = tags(html, 'span').find((span) => (attr(span, 'class') ?? '').split(' ').includes('animate-spin'))
      expect(spinner).toBeDefined()
      expect(attr(spinner ?? '', 'aria-hidden')).toBe('true')
      expect((attr(spinner ?? '', 'class') ?? '').split(' ')).toContain('motion-reduce:animate-none')
      expect(html).toContain('Submitting…</button>')
      expect(text(html)).toContain('Submitting…')
      expect(count(html, '>Submit<')).toBe(0)
    })

    it('And a polite status region says "Submitting…" for screen readers, without silencing the form', () => {
      const status = tags(html, 'p').find((p) => attr(p, 'role') === 'status') ?? ''
      expect(count(html, 'role="status"')).toBe(1)
      expect(html).toContain(`${status}Submitting…</p>`)
      expect((attr(status, 'class') ?? '').split(' ')).toContain('sr-only')
      expect(html).not.toContain('aria-busy')
      expect(html).not.toContain('...')
    })

    it('editing shows "Submit", no spinner and a form that is not busy', () => {
      const editing = render({ ...initialState, values: jane })
      expect(editing).toContain('>Submit</button>')
      expect(editing).not.toContain('animate-spin')
      expect(editing).not.toContain('role="status"')
      expect(editing).not.toContain('aria-disabled')
      for (const input of tags(editing, 'input')) expect(input.toLowerCase()).not.toContain('readonly')
    })
  })

  describe('Scenario: A valid registration is confirmed by name @AC-1', () => {
    const html = render(confirmed)

    it('Then the same screen shows "Thank you, Jane!" and "Your visit has been registered." in place of the form', () => {
      expect(html.startsWith('<main ')).toBe(true)
      expect(html).toContain(' id="registration-card"')
      expect(count(html, '<h1')).toBe(1)
      expect(html).toContain('>Thank you, Jane!</h1>')
      expect(html).toContain('>Your visit has been registered.</p>')
      expect(count(html, '<form')).toBe(0)
      expect(count(html, '<input')).toBe(0)
    })

    it('And the heading can take focus from script, without joining the tab order', () => {
      const [heading] = tags(html, 'h1')
      expect(attr(heading, 'id')).toBe('confirmation-title')
      expect(attr(heading, 'tabindex') ?? attr(heading, 'tabIndex')).toBe('-1')
    })
  })

  describe('Scenario: The confirmation on screen is the only acknowledgement @AC-6', () => {
    const html = render(confirmed)

    it('Then the confirmation shows only the thanks, the sentence and the "Register another visitor" button', () => {
      expect(text(html)).toBe('Thank you, Jane! Your visit has been registered. Register another visitor')
      const buttons = tags(html, 'button')
      expect(buttons).toHaveLength(1)
      expect(attr(buttons[0], 'type')).toBe('button')
      expect(html).toContain('>Register another visitor</button>')
    })

    it('And the confirmation mentions no email or text message', () => {
      const words = text(html).toLowerCase()
      for (const word of ['email', 'e-mail', 'text message', 'sms', 'inbox', 'sent']) expect(words).not.toContain(word)
    })

    it('And it carries none of the details I typed', () => {
      for (const value of ['Doe', 'jane.doe@example.com', '415', '0132']) expect(html).not.toContain(value)
    })

    it('a confirmation without a name still reads naturally', () => {
      const nameless = render(reducer(submitting, { type: 'submitted' }))
      expect(nameless).toContain('>Thank you!</h1>')
    })

    it('the confirmation card keeps the 480px cap, and its button the touch target and focus ring', () => {
      const card = tags(html, 'section')[0]
      expect((attr(card, 'class') ?? '').split(' ')).toEqual(expect.arrayContaining(['w-full', 'max-w-[480px]']))
      const classes = (attr(tags(html, 'button')[0], 'class') ?? '').split(' ')
      expect(classes).toEqual(expect.arrayContaining(['w-full', 'min-h-12', 'focus-visible:outline-3', 'focus-visible:outline-focus']))
      expect((attr(tags(html, 'h1')[0], 'class') ?? '').split(' ')).toContain('focus-visible:outline-focus')
    })
  })

  describe('when the save does not go through', () => {
    it('a 400 shows each server message verbatim under its field, tied to the input', () => {
      const message = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
      const html = render(reducer(submitting, { type: 'failed', errors: { phone: message } }))
      const phone = tags(html, 'input').find((input) => attr(input, 'id') === 'phone') ?? ''
      expect(attr(phone, 'aria-invalid')).toBe('true')
      expect(attr(phone, 'aria-describedby')).toBe('phone-hint phone-error')
      expect(html).toContain(' id="phone-error"')
      expect(html).toContain(`>${message}</p>`)
      expect(count(html, 'aria-invalid')).toBe(1)
      const first = tags(html, 'input').find((input) => attr(input, 'id') === 'firstName') ?? ''
      expect(attr(first, 'aria-describedby')).toBeUndefined()
      expect(html).toContain('>Submit</button>')
      expect(count(html, 'role="alert"')).toBe(0)
    })

    it('a field without a hint is described by its error alone', () => {
      const html = render(reducer(submitting, { type: 'failed', errors: { email: 'Server email text.' } }))
      const email = tags(html, 'input').find((input) => attr(input, 'id') === 'email') ?? ''
      expect(attr(email, 'aria-describedby')).toBe('email-error')
      expect(html).toContain('>Server email text.</p>')
    })

    it('any other failure keeps my values and shows one alert, with Submit ready to try again', () => {
      const html = render(reducer(submitting, { type: 'saveFailed' }))
      expect(count(html, 'role="alert"')).toBe(1)
      expect(text(html)).toContain('Your visit could not be saved. Please try again.')
      expect(tags(html, 'input').map((input) => attr(input, 'value'))).toEqual([' Jane ', 'Doe', 'jane.doe@example.com', '(415) 555-0132'])
      expect(html).toContain('>Submit</button>')
      expect(html).not.toContain('Thank you')
    })
  })
})
