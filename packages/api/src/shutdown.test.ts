import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp, start, stopOnSignals } from './main.js'
import { logger } from './observability/index.js'

// ST-1 AC-1: the one container stops cleanly. tini forwards `docker stop`'s SIGTERM (and
// Ctrl+C's SIGINT) to node, which closes the server and its store once, then exits 0.
class FakeProcess extends EventEmitter {
  readonly exit = vi.fn<(code: number) => void>()
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stopOnSignals @story:ST-1 @criterion:AC-1', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('closes the app once and exits 0 on %s', async (signal) => {
    const app = buildApp({ webRoot: '/nonexistent' })
    const close = vi.spyOn(app, 'close')
    const proc = new FakeProcess()
    stopOnSignals(app, proc)
    proc.emit(signal)
    proc.emit(signal)
    await settle()
    expect(close).toHaveBeenCalledTimes(1)
    expect(proc.exit).toHaveBeenCalledTimes(1)
    expect(proc.exit).toHaveBeenCalledWith(0)
  })

  it('stops listening on a real port before exiting', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'st1-stop-'))
    const app: FastifyInstance = await start({ port: 0, host: '127.0.0.1', webRoot })
    try {
      const proc = new FakeProcess()
      stopOnSignals(app, proc)
      proc.emit('SIGTERM')
      await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0))
      expect(app.server.listening).toBe(false)
    } finally {
      await app.close()
      rmSync(webRoot, { recursive: true, force: true })
    }
  })

  it('logs a failed close without detail and exits 1', async () => {
    const app = buildApp({ webRoot: '/nonexistent' })
    vi.spyOn(app, 'close').mockRejectedValue(Object.assign(new Error('secret detail'), { code: 'EBUSY' }))
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined)
    const proc = new FakeProcess()
    stopOnSignals(app, proc)
    proc.emit('SIGTERM')
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(1))
    expect(error).toHaveBeenCalledWith({ code: 'EBUSY' }, 'shutdown.failed')
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret detail')
  })

  it('ignores signals it was not asked to handle', async () => {
    const app = buildApp({ webRoot: '/nonexistent' })
    const close = vi.spyOn(app, 'close')
    const proc = new FakeProcess()
    stopOnSignals(app, proc)
    proc.emit('SIGHUP')
    await settle()
    expect(close).not.toHaveBeenCalled()
    expect(proc.exit).not.toHaveBeenCalled()
    await app.close()
  })
})
