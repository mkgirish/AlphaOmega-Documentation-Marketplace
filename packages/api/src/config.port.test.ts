import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

// ST-1 AC-1: `docker run -p 3000:3000 <image>` needs no environment variable, and an
// override that cannot work stops the process at once, naming the variable, never its value.
const PORT_ERROR = new Error('PORT must be a whole number from 1 to 65535.')

describe('loadConfig PORT and HOST @story:ST-1 @criterion:AC-1', () => {
  it('accepts every TCP port from 1 to 65535 and nothing beyond', () => {
    expect(loadConfig({ PORT: '1' }).port).toBe(1)
    expect(loadConfig({ PORT: '3000' }).port).toBe(3000)
    expect(loadConfig({ PORT: '65535' }).port).toBe(65535)
    expect(() => loadConfig({ PORT: '0' })).toThrow(PORT_ERROR)
    expect(() => loadConfig({ PORT: '65536' })).toThrow(PORT_ERROR)
  })

  it('treats an empty PORT or HOST as unset, so the defaults still apply', () => {
    expect(loadConfig({ PORT: '', HOST: '' })).toMatchObject({ port: 3000, host: '0.0.0.0' })
  })

  it.each(['abc', '0', '65536', '99999', '-1', '3000.5', '1e3', ' 3000', '3000 ', '0x50', '03000'])(
    'refuses PORT=%j without echoing it',
    (raw) => {
      let message = ''
      expect(() => {
        try {
          loadConfig({ PORT: raw })
        } catch (err) {
          message = (err as Error).message
          throw err
        }
      }).toThrow(PORT_ERROR)
      expect(message).not.toContain(raw.trim())
    },
  )
})
