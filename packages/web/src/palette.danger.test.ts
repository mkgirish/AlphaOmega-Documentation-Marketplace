import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastPairs, contrastRatio, palette } from './palette.js'

// ST-10 — the red used for a flagged name's message (text, 4.5:1) and border (3:1).
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('SCR-1 palette — the danger token', () => {
  it('declares danger in the palette and the stylesheet', () => {
    expect(palette.danger).toMatch(/^#[0-9a-f]{6}$/)
    expect(css).toContain(`--color-danger: ${palette.danger};`)
  })

  it('checks danger as text on the card at 4.5:1 and as a border at 3:1 on card and canvas', () => {
    expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'surface', min: 4.5 })
    expect(contrastPairs).toContainEqual({ fg: 'danger', bg: 'canvas', min: 3 })
    expect(contrastRatio(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.danger, palette.canvas)).toBeGreaterThanOrEqual(3)
  })
})
