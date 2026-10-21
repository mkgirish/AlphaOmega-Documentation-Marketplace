import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const render = vi.fn()
const createRoot = vi.fn(() => ({ render }))
vi.mock('react-dom/client', () => ({ createRoot }))
const stylesheet = vi.hoisted(() => ({ loaded: false }))
vi.mock('./index.css', () => {
  stylesheet.loaded = true
  return {}
})

describe('main entry', () => {
  beforeEach(() => {
    vi.resetModules()
    render.mockClear()
    createRoot.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('mounts the screen into #root', async () => {
    const root = { id: 'root' }
    const getElementById = vi.fn(() => root)
    vi.stubGlobal('document', { getElementById })
    await import('./main.js')
    expect(getElementById).toHaveBeenCalledWith('root')
    expect(createRoot).toHaveBeenCalledWith(root)
    expect(render).toHaveBeenCalledTimes(1)
    // The entry pulls in the Tailwind stylesheet that carries the palette.
    expect(stylesheet.loaded).toBe(true)
  })

  it('does nothing when the page has no #root', async () => {
    vi.stubGlobal('document', { getElementById: () => null })
    await import('./main.js')
    expect(createRoot).not.toHaveBeenCalled()
    expect(stylesheet.loaded).toBe(true)
  })
})
