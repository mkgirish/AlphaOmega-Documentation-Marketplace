import { readdirSync, readFileSync } from 'node:fs'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App.js'
import { initialState, reducer, type FormAction, type FormState } from './reducer.js'
import { focusTarget, Screen, syncScreen, titles } from './Screen.js'

// ST-2 / SCR-1 — the screen in each state the story adds. Screen is hook-free, so it is
// both rendered to markup (what the visitor sees) and walked as an element tree (what
// each control does), without a DOM.
const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }
const editing: FormState = { ...initialState, values: jane }
const submitting = reducer(editing, { type: 'submit' })
const confirmed = reducer(submitting, { type: 'submitted', firstName: 'Jane' })
const invalid = reducer(submitting, { type: 'failed', errors: { email: 'Server <b>says</b> no.', phone: 'Phone message.' } })
const saveFailed = reducer(submitting, { type: 'saveFailed' })

type Props = Record<string, unknown> & { children?: ReactNode }
type Node = { type: string; props: Props; children: Node[] } | string

/** Expand function components (all hook-free) down to host elements and text. */
function expand(node: ReactNode): Node[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(expand)
  if (!isValidElement(node)) return []
  const element = node as ReactElement<Props>
  if (typeof element.type === 'function') return expand((element.type as (props: Props) => ReactNode)(element.props))
  return [{ type: String(element.type), props: element.props, children: expand(element.props.children) }]
}

function tree(state: FormState, dispatch = vi.fn<(action: FormAction) => void>(), onSubmit = vi.fn()) {
  const nodes = expand(<Screen state={state} dispatch={dispatch} onSubmit={onSubmit} />)
  const all = (from: Node[] = nodes): Exclude<Node, string>[] =>
    from.flatMap((node) => (typeof node === 'string' ? [] : [node, ...all(node.children)]))
  const find = (type: string, where: (props: Props) => boolean = () => true) => all().filter((n) => n.type === type && where(n.props))
  return { nodes, all, find, dispatch, onSubmit }
}

const text = (nodes: Node[]): string => nodes.map((node) => (typeof node === 'string' ? node : text(node.children))).join('')
const visibleText = (nodes: Node[]): string =>
  nodes.map((node) => (typeof node === 'string' ? node : node.props['aria-hidden'] === 'true' ? '' : visibleText(node.children))).join('')
const markup = (state: FormState) => renderToStaticMarkup(<Screen state={state} dispatch={() => undefined} onSubmit={() => undefined} />)

function fakeDocument() {
  const focused: string[] = []
  const doc = {
    title: 'Visitor registration',
    getElementById: vi.fn((id: string) => ({ focus: () => focused.push(id) }) as unknown as HTMLElement),
  }
  return { doc, focused }
}

describe('Feature: Submit my details and see a confirmation once my visit is saved', () => {
  describe('Scenario: A valid registration is confirmed by name @AC-1', () => {
    it('Given the registration screen is open, the form state renders exactly the ST-1 screen', () => {
      expect(markup(initialState)).toBe(renderToStaticMarkup(<App />))
    })

    it('When I press Submit, Then the form’s submit handler stays on the page and hands over to the submitter', () => {
      const t = tree(editing)
      const preventDefault = vi.fn()
      const [form] = t.find('form')
      ;(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(t.onSubmit).toHaveBeenCalledTimes(1)
    })

    it('Then the same screen shows "Thank you, Jane!" and "Your visit has been registered."', () => {
      const t = tree(confirmed)
      const [heading] = t.find('h1')
      expect(text(heading.children)).toBe('Thank you, Jane!')
      expect(t.find('h1')).toHaveLength(1)
      expect(text(t.find('p')[0].children)).toBe('Your visit has been registered.')
      expect(t.find('section', (p) => p.id === 'registration-card')).toHaveLength(1)
      expect(t.find('form')).toHaveLength(0)
      expect(t.find('input')).toHaveLength(0)
    })

    it('And the page did not reload: nothing in the confirmation links or posts anywhere', () => {
      const html = markup(confirmed)
      expect(html).not.toContain('href=')
      expect(html).not.toContain('action=')
      expect(html).not.toContain('<form')
      expect(html).not.toContain('<a ')
      expect(html).toContain('<h1 id="confirmation-title" tabindex="-1"')
    })

    it('And focus is on the heading "Thank you, Jane!"', () => {
      expect(focusTarget(confirmed)).toBe('confirmation-title')
      const { doc, focused } = fakeDocument()
      syncScreen(confirmed, doc)
      expect(focused).toEqual(['confirmation-title'])
      const [heading] = tree(confirmed).find('h1')
      expect(heading.props.id).toBe('confirmation-title')
      expect(heading.props.tabIndex).toBe(-1)
    })
  })

  describe('Scenario: The form waits while my visit is being saved @AC-4', () => {
    it('Then the four inputs are read-only and still show my values', () => {
      const inputs = tree(submitting).find('input')
      expect(inputs).toHaveLength(4)
      expect(inputs.map((input) => input.props.value)).toEqual(['Jane', 'Doe', 'jane.doe@example.com', '4155550132'])
      for (const input of inputs) {
        expect(input.props.readOnly).toBe(true)
        expect(input.props.disabled).toBeUndefined()
      }
      const html = markup(submitting)
      expect(html.toLowerCase().split('readonly=""').length - 1).toBe(4)
    })

    it('And the Submit button reads "Submitting…" with a spinner', () => {
      const [button] = tree(submitting).find('button')
      expect(visibleText(button.children)).toBe('Submitting…')
      const [spinner] = tree(submitting).find('svg')
      expect(spinner.props['aria-hidden']).toBe('true')
      const classes = String(spinner.props.className).split(' ')
      expect(classes).toContain('animate-spin')
      expect(classes).toContain('motion-reduce:animate-none')
    })

    it('Submit stays focusable — aria-disabled, never the native disabled that would drop focus to the body', () => {
      const [button] = tree(submitting).find('button')
      expect(button.props['aria-disabled']).toBe('true')
      expect(button.props.disabled).toBeUndefined()
      expect(button.props.type).toBe('submit')
      expect(tree(submitting).find('form')[0].props['aria-busy']).toBe('true')
      expect(focusTarget(submitting)).toBeUndefined()
      const { doc, focused } = fakeDocument()
      syncScreen(submitting, doc)
      expect(focused).toEqual([])
    })

    it('pressing Submit again while saving stays on the page and starts nothing', () => {
      const t = tree(submitting)
      const preventDefault = vi.fn()
      ;(t.find('form')[0].props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault })
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(t.onSubmit).not.toHaveBeenCalled()
    })

    it('only the saving state is read-only or busy', () => {
      for (const state of [initialState, invalid, saveFailed]) {
        const html = markup(state)
        expect(html.toLowerCase()).not.toContain('readonly')
        expect(html).toContain('noValidate=""')
        expect(html).not.toContain('aria-busy')
        expect(html).not.toContain('aria-disabled')
        expect(html).not.toContain('<svg')
        expect(text(tree(state).find('button')[0].children)).toBe('Submit')
      }
    })
  })

  describe('Scenario: The confirmation on screen is the only acknowledgement @AC-6', () => {
    it('Then the confirmation shows only "Thank you, Jane!", "Your visit has been registered." and the "Register another visitor" button', () => {
      const t = tree(confirmed)
      expect(text(t.nodes)).toBe('Thank you, Jane!Your visit has been registered.Register another visitor')
      const buttons = t.find('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].props.type).toBe('button')
      expect(text(buttons[0].children)).toBe('Register another visitor')
    })

    it('And the confirmation mentions no email or text message', () => {
      const words = text(tree(confirmed).nodes).toLowerCase()
      for (const word of ['email', 'e-mail', 'text', 'sms', 'message', 'sent', 'inbox']) expect(words).not.toContain(word)
    })

    it('And the browser tab title reads "Registration complete", without the visitor’s name', () => {
      expect(titles).toEqual({ form: 'Visitor registration', confirmed: 'Registration complete' })
      const { doc } = fakeDocument()
      syncScreen(confirmed, doc)
      expect(doc.title).toBe('Registration complete')
      expect(doc.title).not.toContain('Jane')
    })

    it('every other state keeps the title "Visitor registration"', () => {
      for (const state of [initialState, submitting, invalid, saveFailed]) {
        const { doc } = fakeDocument()
        doc.title = 'Registration complete'
        syncScreen(state, doc)
        expect(doc.title).toBe('Visitor registration')
      }
    })

    it('"Register another visitor" resets the screen and puts the cursor back in First name', () => {
      const t = tree(confirmed)
      ;(t.find('button')[0].props.onClick as () => void)()
      expect(t.dispatch).toHaveBeenCalledWith({ type: 'reset' })
      const next = reducer(confirmed, { type: 'reset' })
      expect(markup(next)).toBe(markup(initialState))
      expect(markup(next)).not.toContain('Jane')
      expect(focusTarget(next)).toBe('firstName')
      const { doc, focused } = fakeDocument()
      syncScreen(next, doc)
      expect(focused).toEqual(['firstName'])
      expect(doc.title).toBe('Visitor registration')
    })
  })

  describe('Scenario: The saving and confirmation states are accessible @AC-7', () => {
    it('the confirmation is one card with one heading, a paragraph and one labelled button, inside the main landmark', () => {
      const html = markup(confirmed)
      expect(html.startsWith('<main ')).toBe(true)
      expect(html.split('<main').length - 1).toBe(1)
      expect(html.split('<h1').length - 1).toBe(1)
      const [card] = tree(confirmed).find('section', (p) => p.id === 'registration-card')
      expect(String(card.props.className).split(' ')).toEqual(expect.arrayContaining(['w-full', 'max-w-[480px]']))
      expect(html).toContain('aria-labelledby="confirmation-title"')
      expect(html).not.toContain('style=')
    })

    it('the confirmation button is a full-width touch target with the palette focus ring', () => {
      const classes = String(tree(confirmed).find('button')[0].props.className).split(' ')
      for (const name of [
        'w-full',
        'min-h-12',
        'focus-visible:outline-3',
        'focus-visible:outline-focus',
        'bg-primary',
        'text-on-primary',
      ]) {
        expect(classes).toContain(name)
      }
    })

    it('the submitting button keeps its accessible name in the visible text, and the spinner is hidden from assistive tech', () => {
      const [button] = tree(submitting).find('button')
      expect(button.props['aria-label']).toBeUndefined()
      expect(visibleText(button.children)).toBe('Submitting…')
      const [spinner] = tree(submitting).find('svg')
      expect(spinner.props.focusable).toBe('false')
    })
  })

  describe('a rejected save (400)', () => {
    it('renders each server-sent message verbatim under its field, tied to it for screen readers', () => {
      const t = tree(invalid)
      const email = t.find('input', (p) => p.id === 'email')[0]
      expect(email.props['aria-invalid']).toBe('true')
      expect(email.props['aria-describedby']).toBe('email-error')
      expect(text(t.find('p', (p) => p.id === 'email-error')[0].children)).toBe('Server <b>says</b> no.')
      const phone = t.find('input', (p) => p.id === 'phone')[0]
      expect(phone.props['aria-describedby']).toBe('phone-hint phone-error')
      expect(text(t.find('p', (p) => p.id === 'phone-error')[0].children)).toBe('Phone message.')
      expect(markup(invalid)).toContain('Server &lt;b&gt;says&lt;/b&gt; no.')
    })

    it('flags no field the server did not name', () => {
      const t = tree(invalid)
      for (const id of ['firstName', 'lastName']) {
        const input = t.find('input', (p) => p.id === id)[0]
        expect(input.props['aria-invalid']).toBeUndefined()
        expect(t.find('p', (p) => p.id === `${id}-error`)).toHaveLength(0)
      }
    })

    it('keeps the values and moves focus to the first flagged field', () => {
      expect(
        tree(invalid)
          .find('input')
          .map((input) => input.props.value),
      ).toEqual(Object.values(jane))
      expect(focusTarget(invalid)).toBe('email')
      const { doc, focused } = fakeDocument()
      syncScreen(invalid, doc)
      expect(focused).toEqual(['email'])
    })

    it('typing in a field dispatches the change for that field', () => {
      const t = tree(invalid)
      const input = t.find('input', (p) => p.id === 'lastName')[0]
      ;(input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Smith' } })
      expect(t.dispatch).toHaveBeenCalledWith({ type: 'change', field: 'lastName', value: 'Smith' })
    })
  })

  describe('a failed save (403, 413, 415, 429, 500 or no network)', () => {
    it('shows the save-failed alert, keeps the values and lets the visitor submit again', () => {
      const t = tree(saveFailed)
      const [alert] = t.find('div', (p) => p.role === 'alert')
      expect(alert.props.id).toBe('form-alert')
      expect(alert.props.tabIndex).toBe(-1)
      expect(text(alert.children)).toBe('Your visit could not be saved. Please try again.')
      expect(t.find('input').map((input) => input.props.value)).toEqual(Object.values(jane))
      expect(t.find('button')[0].props['aria-disabled']).toBeUndefined()
    })

    it('moves focus to the alert so it is read out', () => {
      expect(focusTarget(saveFailed)).toBe('form-alert')
      const { doc, focused } = fakeDocument()
      syncScreen(saveFailed, doc)
      expect(focused).toEqual(['form-alert'])
    })

    it('no other state shows an alert', () => {
      for (const state of [initialState, submitting, invalid, confirmed]) expect(markup(state)).not.toContain('role="alert"')
    })

    it('a missing focus target is skipped quietly', () => {
      const doc = { title: '', getElementById: () => null }
      expect(() => syncScreen(saveFailed, doc)).not.toThrow()
      expect(doc.title).toBe('Visitor registration')
    })
  })

  describe('kiosk hygiene', () => {
    const sources = readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
      .filter((name) => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.'))
      .map((name) => [name, readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')] as const)

    it('no screen source touches browser storage, cookies, history or the URL', () => {
      const banned = [
        'local' + 'Storage',
        'session' + 'Storage',
        'indexed' + 'DB',
        'document.' + 'cookie',
        'history.push' + 'State',
        'history.replace' + 'State',
        'window.' + 'location',
        'document.' + 'location',
        'window.' + 'history',
        'dangerously' + 'SetInnerHTML',
      ]
      for (const [name, source] of sources) for (const word of banned) expect(source, `${name} uses ${word}`).not.toContain(word)
    })

    it('no screen source carries its own field rules: no RegExp and no zod', () => {
      for (const [name, source] of sources) {
        expect(source, name).not.toContain('Reg' + 'Exp')
        expect(source, name).not.toContain("'zod'")
      }
    })

    it('the confirmation never puts the visitor’s name anywhere but the heading text', () => {
      const html = markup(confirmed)
      expect(html.split('Jane').length - 1).toBe(1)
      expect(html).toContain('>Thank you, Jane!</h1>')
    })
  })
})
