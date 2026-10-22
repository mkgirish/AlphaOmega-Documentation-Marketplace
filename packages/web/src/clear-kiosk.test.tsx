import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'
import { formClearedAnnouncement } from './announcement.js'
import { initialState, reducer, type FormState } from './reducer.js'
import { RegistrationScreen } from './Screen.js'

// ST-5 / SCR-1 — clearing the kiosk for the next visitor: what the screen announces when
// the form comes back. The reset itself (blank values, focus, title) is ST-2's reducer.
const noop = () => undefined
const confirmed: FormState = { ...initialState, status: 'confirmed', firstName: 'Jane' }
const render = (state: FormState, announcement?: string) =>
  renderToStaticMarkup(<RegistrationScreen state={state} announcement={announcement} onChange={noop} onSubmit={noop} onReset={noop} />)
const count = (markup: string, needle: string) => markup.split(needle).length - 1

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  if (typeof node.type === 'function') return elements((node.type as (props: unknown) => ReactNode)(node.props))
  return [...(typeof node.type === 'string' ? [node] : []), ...elements(node.props.children as ReactNode)]
}

describe('Feature: Clear the kiosk for the next visitor', () => {
  it('@AC-3 the announcement is "Form cleared for the next visitor"', () => {
    expect(formClearedAnnouncement).toBe('Form cleared for the next visitor')
  })

  it('@AC-3 the confirmation already holds an empty polite region, so the reset text is announced', () => {
    const markup = render(confirmed, '')
    expect(markup).toContain('<p id="announcement" role="status" class="sr-only"></p>')
    expect(count(markup, '<button')).toBe(1)
  })

  it('@AC-3 the reset form carries the announcement in that one region, beside the blank form', () => {
    const markup = render(reducer(confirmed, { type: 'reset' }), formClearedAnnouncement)
    expect(markup).toContain('<p id="announcement" role="status" class="sr-only">Form cleared for the next visitor</p>')
    expect(count(markup, 'role="status"')).toBe(1)
    expect(count(markup, 'role="alert"')).toBe(0)
    expect(count(markup, 'Thank you')).toBe(0)
    expect(count(markup, '<input')).toBe(4)
  })

  it('@AC-3 the first form of the day has no live region', () => {
    expect(render(initialState)).not.toContain('role="status"')
    expect(renderToStaticMarkup(<App />)).not.toContain('role="status"')
  })

  it('@AC-1 one Tab from the heading reaches the only button', () => {
    const all = elements(RegistrationScreen({ state: confirmed, announcement: '', onChange: noop, onSubmit: noop, onReset: noop }))
    const heading = all.findIndex((element) => element.props.id === 'confirmation-title')
    const after = all.slice(heading + 1).filter((element) => element.type === 'button')
    expect(after.map((element) => element.props.children)).toEqual(['Register another visitor'])
  })

  it('@AC-4 the announcement never carries a visitor detail', () => {
    for (const detail of ['Jane', 'jane.doe@example.com', '4155550132']) expect(formClearedAnnouncement).not.toContain(detail)
  })
})
