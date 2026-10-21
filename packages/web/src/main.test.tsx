import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The browser entry, exercised without a DOM: createRoot is mocked and document stubbed.
const render = vi.fn()
const createRoot = vi.fn(() => ({ render }))
const loaded = { stylesheet: false }

vi.mock('react-dom/client', () => ({ createRoot }))
vi.mock('./index.css', () => {
  loaded.stylesheet = true
  return {}
})

describe('SCR-1 entry @story:ST-1', () => {
  beforeEach(() => {
    vi.resetModules()
    render.mockClear()
    createRoot.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the screen stylesheet and mounts the App into #root @criterion:AC-1', async () => {
    const root = { id: 'root' }
    const getElementById = vi.fn(() => root)
    vi.stubGlobal('document', { getElementById })
    await import('./main.js')
    expect(loaded.stylesheet).toBe(true)
    expect(getElementById).toHaveBeenCalledWith('root')
    expect(createRoot).toHaveBeenCalledWith(root)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('mounts nothing when #root is missing @criterion:AC-1', async () => {
    vi.stubGlobal('document', { getElementById: () => null })
    await import('./main.js')
    expect(createRoot).not.toHaveBeenCalled()
  })
})
