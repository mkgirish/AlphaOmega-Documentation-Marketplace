import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.js'

// SCR-1 rendered to markup: the copy and structure the visitor sees on first open (ST-1).
const html = renderToStaticMarkup(<App />)

/** The opening tag of the element carrying the given id. */
function tagWithId(id: string): string {
  const start = html.lastIndexOf('<', html.indexOf(`id="${id}"`))
  return html.slice(start, html.indexOf('>', start) + 1)
}

/** The text of the label pointing at the given id. */
function labelFor(id: string): string {
  const at = html.indexOf(`for="${id}"`)
  expect(html.lastIndexOf('<label', at)).toBe(html.lastIndexOf('<', at))
  return html.slice(html.indexOf('>', at) + 1, html.indexOf('</label>', at))
}

function count(fragment: string): number {
  return html.split(fragment).length - 1
}

describe('SCR-1 registration screen markup @story:ST-1', () => {
  it('is titled "Visitor registration" and reads the intro line exactly @criterion:AC-2', () => {
    expect(html).toContain('>Visitor registration</h1>')
    expect(count('<h1')).toBe(1)
    expect(html).toContain('>Please register. All fields are required.</p>')
  })

  it.each([
    ['firstName', 'First name', 'text'],
    ['lastName', 'Last name', 'text'],
    ['email', 'Email', 'email'],
    ['phone', 'Phone number', 'tel'],
  ])('labels the %s input "%s", marks it required and starts it blank @criterion:AC-2 @criterion:AC-4', (id, label, type) => {
    expect(labelFor(id)).toBe(label)
    const tag = tagWithId(id)
    expect(tag.startsWith('<input')).toBe(true)
    expect(tag).toContain(`type="${type}"`)
    expect(tag).toContain(`name="${id}"`)
    expect(tag).toContain('required=""')
    expect(tag).toContain('autoComplete="off"')
    expect(tag).toContain('value=""')
    expect(tag).not.toContain('aria-invalid')
  })

  it('shows exactly four inputs, in visiting order @criterion:AC-2 @criterion:AC-6', () => {
    expect(count('<input')).toBe(4)
    const order = ['firstName', 'lastName', 'email', 'phone'].map((id) => html.indexOf(`id="${id}"`))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('shows the phone hint under the phone input and ties it to the input @criterion:AC-2', () => {
    expect(html).toContain('id="phone-hint"')
    expect(html).toContain('>10-digit US number, e.g. (415) 555-0132</p>')
    expect(tagWithId('phone')).toContain('aria-describedby="phone-hint"')
    expect(html.indexOf('id="phone-hint"')).toBeGreaterThan(html.indexOf('id="phone"'))
  })

  it('shows exactly one button, "Submit", last in the form @criterion:AC-2 @criterion:AC-6', () => {
    expect(count('<button')).toBe(1)
    expect(html).toContain('type="submit"')
    expect(html).toContain('>Submit</button>')
    expect(html.indexOf('<button')).toBeGreaterThan(html.indexOf('id="phone"'))
    expect(html).not.toContain('disabled')
  })

  it('has no links, menu or navigation @criterion:AC-3', () => {
    for (const fragment of ['<a ', '<nav', 'role="navigation"', 'role="menu"', 'role="link"', 'href=']) {
      expect(html).not.toContain(fragment)
    }
  })

  it('puts the cursor in First name and nowhere else @criterion:AC-4', () => {
    expect(tagWithId('firstName')).toContain('autofocus=""')
    expect(count('autofocus')).toBe(1)
  })

  it('shows no field error, summary box or alert on first open @criterion:AC-4', () => {
    for (const fragment of ['role="alert"', 'role="status"', 'aria-live', 'aria-invalid']) {
      expect(html).not.toContain(fragment)
    }
  })

  it('turns native validation bubbles off and caps the card at 480px @criterion:AC-5', () => {
    const form = html.slice(html.indexOf('<form'), html.indexOf('>', html.indexOf('<form')) + 1)
    expect(form).toContain('noValidate=""')
    expect(form).toContain('max-w-[30rem]')
    expect(form).toContain('aria-labelledby="screen-title"')
    expect(tagWithId('screen-title').startsWith('<h1')).toBe(true)
  })

  it('uses no inline style @criterion:AC-7', () => {
    expect(html).not.toContain('style=')
  })
})
