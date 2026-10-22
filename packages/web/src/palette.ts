// SCR-1 palette — the only colours the screen uses; index.css declares the same tokens as
// Tailwind theme colours. Every pair the screen draws is checked against WCAG 2.1 AA.
export const palette = {
  canvas: '#eef1f5',
  surface: '#ffffff',
  ink: '#17202e',
  muted: '#475164',
  edge: '#66707f',
  primary: '#1f4fa3',
  'primary-strong': '#183d80',
  'on-primary': '#ffffff',
  focus: '#9a3f00',
  danger: '#b3261e',
} as const

export type Token = keyof typeof palette

export interface ContrastPair {
  readonly fg: Token
  readonly bg: Token
  /** 4.5 for text (SC 1.4.3), 3 for borders and the focus ring (SC 1.4.11). */
  readonly min: 4.5 | 3
}

export const contrastPairs: readonly ContrastPair[] = [
  { fg: 'ink', bg: 'surface', min: 4.5 },
  { fg: 'ink', bg: 'canvas', min: 4.5 },
  { fg: 'muted', bg: 'surface', min: 4.5 },
  { fg: 'on-primary', bg: 'primary', min: 4.5 },
  { fg: 'on-primary', bg: 'primary-strong', min: 4.5 },
  { fg: 'edge', bg: 'surface', min: 3 },
  { fg: 'edge', bg: 'canvas', min: 3 },
  { fg: 'focus', bg: 'surface', min: 3 },
  { fg: 'focus', bg: 'canvas', min: 3 },
  { fg: 'primary', bg: 'surface', min: 3 },
  { fg: 'danger', bg: 'surface', min: 4.5 },
  { fg: 'danger', bg: 'canvas', min: 3 },
]

const hexDigits = '0123456789abcdef'

function channel(hex: string, at: number): number {
  const hi = hexDigits.indexOf(hex[at])
  const lo = hexDigits.indexOf(hex[at + 1])
  if (hi === -1 || lo === -1) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const srgb = (hi * 16 + lo) / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance(colour: string): number {
  const hex = colour.toLowerCase()
  if (hex.length !== 7 || !hex.startsWith('#')) throw new Error(`Not a #rrggbb colour: ${colour}`)
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

/** The WCAG 2.1 contrast ratio between two #rrggbb colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
