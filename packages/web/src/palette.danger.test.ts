import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastPairs, contrastRatio, palette } from './palette.js'

// ST-10 — the red used for a flagged name's message and border is a palette token,
// declared to Tailwind and contrast-checked like every other.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('SCR-1 palette — the danger token for flagged fields', () => {
  it('is declared as a Tailwind theme colour with the same value', () => {
    expect(palette.danger).toMatch(/^#[0-9a-f]{6}$/)
    expect(css).toContain(`--color-danger: ${palette.danger};`)
  })

  it('is checked as message text (4.5:1) and as a border (3:1) on the card and the canvas', () => {
    expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'surface', min: 4.5 })
    expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'canvas', min: 4.5 })
    expect(contrastRatio(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.danger, palette.canvas)).toBeGreaterThanOrEqual(4.5)
  })
})
