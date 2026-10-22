import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { initialState, type FieldErrors, type FormState } from './reducer.js'
import { RegistrationView } from './RegistrationView.js'

// ST-10 / SCR-1 — the screen in each state a name check reaches, rendered to static
// markup (the web package has no DOM test environment). The messages are the ones the
// server sends; the screen renders them verbatim and owns no copy of the rule.
const long = (length: number) => 'a'.repeat(length)
const firstNameMessage = 'First name must be 100 characters or fewer.'
const lastNameMessage = 'Last name must be 100 characters or fewer.'

const render = (state: FormState) =>
  renderToStaticMarkup(<RegistrationView state={state} onChange={() => undefined} onSubmit={() => undefined} />)

const flagged = (values: Partial<FormState['values']>, errors: FieldErrors): FormState => ({
  ...initialState,
  status: 'invalid',
  values: { ...initialState.values, ...values },
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

const classes = (tag: string) => (attr(tag, 'class') ?? '').split(' ')

describe('Feature: Have my real name accepted, with a clear limit on length — the screen', () => {
  describe('Scenario: An over-long first name is flagged @AC-3', () => {
    const html = render(flagged({ firstName: long(101), lastName: 'Dupont' }, { firstName: firstNameMessage }))

    it('Then "First name must be 100 characters or fewer." appears directly under "First name"', () => {
      const input = tagWithId(html, 'firstName')
      const message = tagWithId(html, 'firstName-error')
      expect(html).toContain(`${input}${message}${firstNameMessage}</p>`)
      expect(html.indexOf('>First name</label>')).toBeLessThan(html.indexOf(input))
    })

    it('the message is tied to the input for screen readers and the input is marked invalid with the red border', () => {
      const input = tagWithId(html, 'firstName')
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect(attr(input, 'aria-describedby')).toBe('firstName-error')
      expect(classes(input)).toContain('border-danger')
      expect(classes(input)).not.toContain('border-edge')
      expect(classes(tagWithId(html, 'firstName-error'))).toContain('text-danger')
    })

    it('only First name is flagged', () => {
      const last = tagWithId(html, 'lastName')
      expect(attr(last, 'aria-invalid')).toBeUndefined()
      expect(classes(last)).toContain('border-edge')
      expect(html).not.toContain('lastName-error')
      expect(html.split('aria-invalid="true"').length - 1).toBe(1)
    })

    it('And no confirmation is shown', () => {
      expect(html).not.toContain('id="confirmation"')
      expect(html).toContain('<form')
    })
  })

  describe('Scenario: An over-long last name is flagged @AC-3', () => {
    const html = render(flagged({ firstName: 'Siobhan', lastName: long(101) }, { lastName: lastNameMessage }))

    it('Then "Last name must be 100 characters or fewer." appears directly under "Last name"', () => {
      const input = tagWithId(html, 'lastName')
      expect(html).toContain(`${input}${tagWithId(html, 'lastName-error')}${lastNameMessage}</p>`)
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect(attr(input, 'aria-describedby')).toBe('lastName-error')
      expect(html).not.toContain('firstName-error')
    })

    it('And no confirmation is shown', () => {
      expect(html).not.toContain('id="confirmation"')
    })
  })

  describe('Scenario: The field keeps everything I typed @AC-4', () => {
    it('Then the field holds all 101 characters — no maxlength cuts it off', () => {
      const html = render(
        flagged({ firstName: long(101), lastName: long(101) }, { firstName: firstNameMessage, lastName: lastNameMessage }),
      )
      for (const id of ['firstName', 'lastName']) {
        const input = tagWithId(html, id)
        expect(attr(input, 'value')).toBe(long(101))
        expect(input.toLowerCase()).not.toContain('maxlength')
      }
      const empty = render(initialState)
      expect(empty.toLowerCase()).not.toContain('maxlength')
    })
  })

  describe('Scenario: The name message clears once the name is short enough @AC-5', () => {
    it('Then the first name message and the red border are gone', () => {
      const html = render({ ...initialState, values: { ...initialState.values, firstName: long(100) } })
      const input = tagWithId(html, 'firstName')
      expect(html).not.toContain('firstName-error')
      expect(html).not.toContain(firstNameMessage)
      expect(attr(input, 'aria-invalid')).toBeUndefined()
      expect(classes(input)).not.toContain('border-danger')
      expect(attr(input, 'value')).toBe(long(100))
    })
  })

  describe('Scenario Outline: Real-world names are accepted as written @AC-1', () => {
    it.each(['Siobhan', 'Anne-Marie', 'José', "O'Brien"])('Then I see the confirmation, greeting %s as written', (name) => {
      const html = render({ ...initialState, status: 'confirmed', confirmedName: name })
      const confirmation = tagWithId(html, 'confirmation')
      expect(attr(confirmation, 'role')).toBe('status')
      expect(attr(confirmation, 'tabindex')).toBe('-1')
      const spellings = [name, name.replace("'", '&#x27;'), name.replace("'", '&#39;')]
      expect(spellings.some((spelling) => html.includes(`${confirmation}Thank you, ${spelling}. You are registered.</p>`))).toBe(true)
      expect(html).not.toContain('<form')
    })
  })

  describe('submitting and failed saves', () => {
    it('while submitting, Submit stays focusable and announces it is busy — never native disabled', () => {
      const html = render({ ...initialState, status: 'submitting', submitting: true })
      const button = tagWithId(html, 'submit')
      expect(button).not.toContain('disabled=""')
      expect(attr(button, 'aria-disabled')).toBe('true')
      expect(html).toContain(`${button}Submit</button>`)
    })

    it('a failed save shows one alert and flags no field', () => {
      const html = render({ ...initialState, status: 'saveFailed' })
      const alert = tagWithId(html, 'save-error')
      expect(attr(alert, 'role')).toBe('alert')
      expect(html).toContain(`${alert}Your registration could not be saved. Please try again.</p>`)
      expect(html).not.toContain('aria-invalid')
      expect(attr(tagWithId(html, 'submit'), 'aria-disabled')).toBeUndefined()
    })

    it('a hint and an error are both announced for a flagged phone number', () => {
      const html = render(flagged({ phone: '1' }, { phone: 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.' }))
      expect((attr(tagWithId(html, 'phone'), 'aria-describedby') ?? '').split(' ').sort()).toEqual(['phone-error', 'phone-hint'])
    })
  })

  describe('the screen hands every edit and every Submit to its owner', () => {
    type Props = { id?: string; onSubmit?: (event: unknown) => void; onChange?: (event: unknown) => void; children?: ReactNode }

    /** Every element in the tree the view returns, depth first (no DOM needed). */
    function elements(node: ReactNode): ReactElement<Props>[] {
      if (Array.isArray(node)) return node.flatMap(elements)
      if (!isValidElement<Props>(node)) return []
      return [node, ...elements(node.props.children)]
    }

    const tree = (onChange = vi.fn(), onSubmit = vi.fn()) => elements(RegistrationView({ state: initialState, onChange, onSubmit }))

    it('Submit prevents the browser’s own submission and calls onSubmit once', () => {
      const onSubmit = vi.fn()
      const form = tree(vi.fn(), onSubmit).find((element) => element.type === 'form')
      const preventDefault = vi.fn()
      form?.props.onSubmit?.({ preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('typing 101 characters into First name hands all of them to onChange', () => {
      const onChange = vi.fn()
      const input = tree(onChange).find((element) => element.type === 'input' && element.props.id === 'firstName')
      input?.props.onChange?.({ target: { value: long(101) } })
      expect(onChange).toHaveBeenCalledWith('firstName', long(101))
    })
  })
})
