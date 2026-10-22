import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { RegistrationScreen, type RegistrationScreenProps } from './RegistrationScreen.js'
import { initialState, reducer, type FormState } from './reducer.js'

// ST-10 / SCR-1 — the screen for each state the name rules produce. Rendered to static
// markup for what the visitor sees, and walked as an element tree to drive its handlers
// (the web package has no DOM test environment; browser-level checks live in e2e/).
const long = (n: number) => 'é'.repeat(n)
const valid = { firstName: 'Siobhan', lastName: "O'Brien", email: 'siobhan@example.com', phone: '(415) 555-0132' }
const firstNameMessage = 'Message for first name, as the server sent it.'
const lastNameMessage = 'Message for last name, as the server sent it.'

const submitting = reducer({ ...initialState, values: valid }, { type: 'submit' })
const flaggedFirst = reducer(reducer({ ...initialState, values: { ...valid, firstName: long(101) } }, { type: 'submit' }), {
  type: 'failed',
  errors: { firstName: firstNameMessage },
})
const flaggedLast = reducer(reducer({ ...initialState, values: { ...valid, lastName: long(101) } }, { type: 'submit' }), {
  type: 'failed',
  errors: { lastName: lastNameMessage },
})

function props(state: FormState, overrides: Partial<RegistrationScreenProps> = {}): RegistrationScreenProps {
  return { state, onChange: vi.fn(), onSubmit: vi.fn(), onReset: vi.fn(), ...overrides }
}

const render = (state: FormState) => renderToStaticMarkup(<RegistrationScreen {...props(state)} />)

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

type AnyProps = Record<string, unknown> & { children?: ReactNode }

/** Every element in the tree RegistrationScreen returns, depth first. */
function elements(node: ReactNode): ReactElement<AnyProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<AnyProps>(node)) return []
  return [node, ...elements(node.props.children)]
}

const find = (tree: ReactNode, predicate: (props: AnyProps, type: unknown) => boolean) => {
  const found = elements(tree).find((element) => predicate(element.props, element.type))
  expect(found).toBeDefined()
  return found as ReactElement<AnyProps>
}

describe('Feature: Have my real name accepted, with a clear limit on length', () => {
  describe('Scenario: The field keeps everything I typed @AC-4', () => {
    it('Given the first name field is empty, no input carries a length cap', () => {
      const html = render(initialState)
      expect(attr(tagWithId(html, 'firstName'), 'value')).toBe('')
      expect(html.toLowerCase()).not.toContain('maxlength')
    })

    it('When I type 101 characters into it, Then the field holds all 101 characters', () => {
      const onChange = vi.fn()
      const tree = RegistrationScreen(props(initialState, { onChange }))
      const input = find(tree, (p) => p.id === 'firstName')
      ;(input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: long(101) } })
      expect(onChange).toHaveBeenCalledWith('firstName', long(101))
      const typed = reducer(initialState, { type: 'change', field: 'firstName', value: long(101) })
      expect(attr(tagWithId(render(typed), 'firstName'), 'value')).toBe(long(101))
    })

    it('a flagged 101-character name stays whole in the field so the message can be acted on', () => {
      const html = render(flaggedFirst)
      expect(attr(tagWithId(html, 'firstName'), 'value')).toBe(long(101))
      expect(html.toLowerCase()).not.toContain('maxlength')
    })
  })

  describe('Scenario: An over-long first name is flagged @AC-3', () => {
    const html = render(flaggedFirst)

    it('Then the message appears directly under "First name", verbatim, tied to the input', () => {
      const input = tagWithId(html, 'firstName')
      const message = tagWithId(html, 'firstName-error')
      expect(html).toContain(`${message}${firstNameMessage}</p>`)
      expect(html.indexOf(message)).toBeGreaterThan(html.indexOf(input))
      expect(html.indexOf(message)).toBeLessThan(html.indexOf('<label for="lastName"'))
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect(attr(input, 'aria-describedby')).toBe('firstName-error')
      expect(classes(message)).toContain('text-danger')
    })

    it('and the input has the red border; no other field is flagged', () => {
      expect(classes(tagWithId(html, 'firstName'))).toContain('border-danger')
      expect(classes(tagWithId(html, 'firstName'))).not.toContain('border-edge')
      for (const id of ['lastName', 'email', 'phone']) {
        expect(attr(tagWithId(html, id), 'aria-invalid')).toBeUndefined()
        expect(classes(tagWithId(html, id))).toContain('border-edge')
        expect(html).not.toContain(`id="${id}-error"`)
      }
    })

    it('And no confirmation is shown', () => {
      expect(html).not.toContain('id="confirmation"')
      expect(html).not.toContain('role="status"')
      expect(html).toContain('<form')
    })
  })

  describe('Scenario: An over-long last name is flagged @AC-3', () => {
    const html = render(flaggedLast)

    it('Then the message appears directly under "Last name"', () => {
      const input = tagWithId(html, 'lastName')
      const message = tagWithId(html, 'lastName-error')
      expect(html).toContain(`${message}${lastNameMessage}</p>`)
      expect(html.indexOf(message)).toBeGreaterThan(html.indexOf(input))
      expect(html.indexOf(message)).toBeLessThan(html.indexOf('<label for="email"'))
      expect(attr(input, 'aria-invalid')).toBe('true')
      expect(classes(input)).toContain('border-danger')
      expect(attr(tagWithId(html, 'firstName'), 'aria-invalid')).toBeUndefined()
    })

    it('And no confirmation is shown', () => {
      expect(html).not.toContain('id="confirmation"')
    })
  })

  describe('Scenario: The name message clears once the name is short enough @AC-5', () => {
    it('When I delete one character, Then the first name message and the red border are gone without pressing Submit', () => {
      const shortened = reducer(flaggedFirst, { type: 'change', field: 'firstName', value: long(100) })
      const html = render(shortened)
      const input = tagWithId(html, 'firstName')
      expect(html).not.toContain('firstName-error')
      expect(html).not.toContain(firstNameMessage)
      expect(classes(input)).not.toContain('border-danger')
      expect(classes(input)).toContain('border-edge')
      expect(attr(input, 'aria-invalid')).toBeUndefined()
      expect(attr(input, 'aria-describedby')).toBeUndefined()
      expect(attr(input, 'value')).toBe(long(100))
    })
  })

  describe('Scenario Outline: Real-world names are accepted as written @AC-1', () => {
    it.each(['Siobhan', 'Anne-Marie', 'José'])('Then I see the confirmation, greeting %s by name', (name) => {
      const confirmed = reducer(submitting, { type: 'submitted', firstName: name })
      const html = render(confirmed)
      const confirmation = tagWithId(html, 'confirmation')
      expect(attr(confirmation, 'tabindex')).toBe('-1')
      expect(attr(confirmation, 'aria-labelledby')).toBe('confirmation-message')
      const message = tagWithId(html, 'confirmation-message')
      expect(attr(message, 'role')).toBe('status')
      const text = html.slice(html.indexOf(message) + message.length, html.indexOf('</p>', html.indexOf(message)))
      expect(text.replaceAll('&#x27;', "'")).toContain(name)
      expect(html).not.toContain('<form')
      expect(html).not.toContain('<input')
    })

    it('the confirmation offers a reset for the next visitor', () => {
      const onReset = vi.fn()
      const tree = RegistrationScreen(props(reducer(submitting, { type: 'submitted', firstName: 'Ada' }), { onReset }))
      const button = find(tree, (p, type) => type === 'button' && p.children === 'Register another visitor')
      expect(button.props.type).toBe('button')
      ;(button.props.onClick as () => void)()
      expect(onReset).toHaveBeenCalledTimes(1)
    })
  })

  describe('Submit', () => {
    it('pressing Submit prevents the native post and asks once to submit', () => {
      const onSubmit = vi.fn()
      const tree = RegistrationScreen(props(initialState, { onSubmit }))
      const form = find(tree, (_p, type) => type === 'form')
      const preventDefault = vi.fn()
      ;(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('while submitting, Submit is aria-disabled (never native disabled) and the form is busy', () => {
      const html = render(submitting)
      const button = tagWithId(html, 'submit')
      expect(attr(button, 'aria-disabled')).toBe('true')
      expect(button).not.toContain(' disabled=""')
      for (const id of ['firstName', 'lastName', 'email', 'phone']) expect(tagWithId(html, id)).toContain(' readOnly=""')
      expect(attr(html.slice(html.indexOf('<form')), 'aria-busy')).toBe('true')
    })

    it('a failed save shows the alert, keeps the values and flags no field', () => {
      const failed = reducer(submitting, { type: 'saveFailed' })
      const html = render(failed)
      expect(html).toContain(`${tagWithId(html, 'save-failed')}Your registration could not be saved. Please try again.</p>`)
      expect(html).not.toContain('readOnly')
      expect(attr(tagWithId(html, 'save-failed'), 'role')).toBe('alert')
      expect(attr(tagWithId(html, 'lastName'), 'value')).toBe('O&#x27;Brien')
      expect(html).not.toContain('aria-invalid')
      expect(html).not.toContain('id="confirmation"')
    })
  })

  describe('shared rules only', () => {
    it('no screen source carries a regex, zod or a length rule or message of its own', () => {
      const sources = readdirSync(new URL('.', import.meta.url)).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      expect(sources).toEqual(
        expect.arrayContaining(['RegistrationScreen.tsx', 'api.ts', 'submit.ts', 'focus.ts', 'App.tsx', 'reducer.ts']),
      )
      for (const file of sources) {
        const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
        expect(source, file).not.toMatch(/RegExp|from 'zod'|maxLength|characters or fewer|\.(test|exec)\(|\.match\(/)
        expect(source, file).not.toMatch(/[=(,:]\s*\/[^/*\s][^/\n]*\/[dgimsuy]*/)
      }
    })
  })
})
