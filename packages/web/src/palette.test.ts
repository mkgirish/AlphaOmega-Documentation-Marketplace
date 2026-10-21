import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastPairs, contrastRatio, palette } from './palette.js'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('SCR-1 palette', () => {
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('rejects a colour that is not #rrggbb', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow()
    expect(() => contrastRatio('#fff', '#ffffff')).toThrow()
    expect(() => contrastRatio('#gggggg', '#ffffff')).toThrow()
  })

  it.each(contrastPairs)('$fg on $bg meets $min:1 (WCAG 2.1 AA)', ({ fg, bg, min }) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(min)
  })

  it('checks text at 4.5:1 and non-text UI (borders, focus ring) at 3:1', () => {
    for (const pair of contrastPairs) expect([4.5, 3]).toContain(pair.min)
    expect(contrastPairs.filter((pair) => pair.fg === 'ink' || pair.fg === 'muted').every((pair) => pair.min === 4.5)).toBe(true)
  })

  it('every token is used in at least one checked pair', () => {
    for (const token of Object.keys(palette)) {
      expect(
        contrastPairs.some((pair) => pair.fg === token || pair.bg === token),
        token,
      ).toBe(true)
    }
  })

  it('the stylesheet declares exactly these tokens and drops the default Tailwind colours', () => {
    expect(css).toContain("@import 'tailwindcss';")
    expect(css).toContain('--color-*: initial;')
    for (const [token, hex] of Object.entries(palette)) expect(css).toContain(`--color-${token}: ${hex};`)
    const declared = css
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('--color-') && !line.startsWith('--color-*'))
    expect(declared).toHaveLength(Object.keys(palette).length)
  })
})
