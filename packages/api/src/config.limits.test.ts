import { describe, expect, it } from 'vitest'
import { DEFAULT_RATE_LIMITS, loadConfig } from './config.js'

// ST-2: the store location and the IF-2 rate limits come from the environment, with defaults.
describe('loadConfig for registrations @story:ST-2', () => {
  it('defaults to no database and 30 per address / 300 overall per minute', () => {
    const config = loadConfig({})
    expect(config.databaseUrl).toBeUndefined()
    expect(config.rateLimits).toEqual({ perIpPerMinute: 30, globalPerMinute: 300 })
    expect(DEFAULT_RATE_LIMITS).toEqual({ perIpPerMinute: 30, globalPerMinute: 300 })
    expect(loadConfig({ DATABASE_URL: '' }).databaseUrl).toBeUndefined()
  })

  it('reads DATABASE_URL and both limits', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://app@localhost/registrations',
      RATE_LIMIT_PER_IP_PER_MIN: '5',
      RATE_LIMIT_GLOBAL_PER_MIN: '50',
    })
    expect(config.databaseUrl).toBe('postgres://app@localhost/registrations')
    expect(config.rateLimits).toEqual({ perIpPerMinute: 5, globalPerMinute: 50 })
  })

  it.each(['0', '-1', '1.5', 'ten', ' 5', '1e3', '9999999999'])('rejects the limit %j without echoing it', (bad) => {
    for (const name of ['RATE_LIMIT_PER_IP_PER_MIN', 'RATE_LIMIT_GLOBAL_PER_MIN']) {
      let message = ''
      try {
        loadConfig({ [name]: bad })
      } catch (err) {
        message = (err as Error).message
      }
      expect(message).toBe(`${name} must be a positive whole number.`)
    }
  })
})
