import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The SCR-1 palette lives in index.css as Tailwind 4 theme tokens; every pairing the screen
// uses must meet WCAG 2.1 AA (4.5:1 for text, 3:1 for borders, focus rings and controls).
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function token(name: string): string {
  const marker = `--color-${name}:`
  const start = css.indexOf(marker)
  expect(start, `token --color-${name}`).toBeGreaterThan(-1)
  return css.slice(start + marker.length, css.indexOf(';', start)).trim()
}

function luminance(hex: string): number {
  expect(hex).toHaveLength(7)
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('SCR-1 palette @story:ST-1', () => {
  it('replaces Tailwind’s default colours with the screen’s own tokens @criterion:AC-6', () => {
    expect(css).toContain("@import 'tailwindcss';")
    expect(css).toContain('--color-*: initial;')
  })

  it.each([
    ['ink', 'card', 4.5],
    ['ink', 'page', 4.5],
    ['muted', 'card', 4.5],
    ['muted', 'page', 4.5],
    ['on-accent', 'accent', 4.5],
    ['line', 'card', 3],
    ['accent', 'card', 3],
    ['accent', 'page', 3],
    ['focus', 'card', 3],
    ['focus', 'page', 3],
  ])('%s on %s reaches %s:1 @criterion:AC-6', (fg, bg, minimum) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(minimum)
  })
})
