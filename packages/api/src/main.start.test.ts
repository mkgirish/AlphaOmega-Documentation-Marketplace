import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { start } from './main.js'
import { CONTENT_SECURITY_POLICY } from './plugins/security.js'

// ST-1 AC-1: the container's one process starts with nothing but its defaults, serves the
// screen over a real socket, and stops cleanly when `docker stop` sends SIGTERM via tini.
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const INDEX_HTML = '<!doctype html><html lang="en"><head><title>Visitor registration</title></head><body></body></html>'

let webRoot: string
let app: FastifyInstance | undefined

beforeAll(() => {
  webRoot = mkdtempSync(join(tmpdir(), 'st1-start-'))
  writeFileSync(join(webRoot, 'index.html'), INDEX_HTML)
})

afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true })
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

function baseUrl(instance: FastifyInstance): string {
  const address = instance.server.address()
  if (address === null || typeof address === 'string') throw new Error('no TCP address')
  return `http://127.0.0.1:${address.port}`
}

async function started(): Promise<{ signals: EventEmitter; exit: ReturnType<typeof vi.fn> }> {
  const signals = new EventEmitter()
  const exit = vi.fn()
  app = await start({ port: 0, host: '127.0.0.1', webRoot }, { signals, exit })
  return { signals, exit }
}

describe('start() runs the one container process @story:ST-1 @criterion:AC-1', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    'serves the screen over HTTP with no database, then closes and exits 0 on %s @story:ST-1 @criterion:AC-7',
    async (signal) => {
      const { signals, exit } = await started()
      const instance = app!
      const url = baseUrl(instance)
      const res = await fetch(`${url}/`, { headers: { accept: BROWSER_ACCEPT } })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/^text\/html/i)
      expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY)
      expect(await res.text()).toBe(INDEX_HTML)
      signals.emit(signal)
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
      expect(instance.server.listening).toBe(false)
      expect(exit).toHaveBeenCalledTimes(1)
      await expect(fetch(`${url}/`)).rejects.toThrow()
      app = undefined
    },
  )

  it('offers no admin or listing page over HTTP while it runs @story:ST-1 @criterion:AC-3', async () => {
    const { signals, exit } = await started()
    for (const path of ['/admin', '/api/registrations']) {
      const res = await fetch(`${baseUrl(app!)}${path}`, { headers: { accept: BROWSER_ACCEPT } })
      expect([404, 405]).toContain(res.status)
      expect(await res.text()).not.toContain('<html')
    }
    expect(signals.listenerCount('SIGTERM')).toBe(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it('handles a repeated signal only once', async () => {
    const { signals, exit } = await started()
    signals.emit('SIGTERM')
    signals.emit('SIGTERM')
    signals.emit('SIGINT')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(exit).toHaveBeenCalledTimes(1)
    app = undefined
  })

  it('exits 1 when closing fails', async () => {
    const { signals, exit } = await started()
    const close = vi.spyOn(app!, 'close').mockRejectedValueOnce(new Error('close failed'))
    signals.emit('SIGTERM')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1))
    expect(close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('stops listening for signals once the server is closed', async () => {
    const { signals, exit } = await started()
    expect(signals.listenerCount('SIGTERM')).toBe(1)
    expect(signals.listenerCount('SIGINT')).toBe(1)
    await app!.close()
    app = undefined
    expect(signals.listenerCount('SIGTERM')).toBe(0)
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(exit).not.toHaveBeenCalled()
  })

  it('watches the real process signals by default and releases them on close', async () => {
    const before = process.listenerCount('SIGTERM')
    app = await start({ port: 0, host: '127.0.0.1', webRoot })
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)
    await app.close()
    app = undefined
    expect(process.listenerCount('SIGTERM')).toBe(before)
  })
})
