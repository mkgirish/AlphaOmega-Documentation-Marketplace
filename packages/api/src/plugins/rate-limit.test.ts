import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit.js'

// IF-2 rate limits: per client address and global, in one-minute windows.
describe('createRateLimiter @story:ST-2', () => {
  it('spends the per-key allowance, then refuses that key only', () => {
    const limiter = createRateLimiter({ perIpPerMinute: 2, globalPerMinute: 10 }, () => 0)
    expect([limiter.take('a'), limiter.take('a'), limiter.take('a')]).toEqual([true, true, false])
    expect(limiter.take('b')).toBe(true)
  })

  it('refuses every key once the global allowance is spent', () => {
    const limiter = createRateLimiter({ perIpPerMinute: 5, globalPerMinute: 2 }, () => 0)
    expect([limiter.take('a'), limiter.take('b'), limiter.take('c')]).toEqual([true, true, false])
  })

  it('starts afresh when the minute is over', () => {
    let now = 1_000
    const limiter = createRateLimiter({ perIpPerMinute: 1, globalPerMinute: 1 }, () => now)
    expect(limiter.take('a')).toBe(true)
    now += 59_999
    expect(limiter.take('a')).toBe(false)
    now += 1
    expect(limiter.take('a')).toBe(true)
  })

  it('reads the clock from Date.now by default', () => {
    expect(createRateLimiter({ perIpPerMinute: 1, globalPerMinute: 1 }).take('a')).toBe(true)
  })
})
