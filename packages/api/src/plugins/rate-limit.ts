// IF-2 rate limits: a fixed one-minute window per client address and one for everyone.
// The key is the socket address — trustProxy is off, so X-Forwarded-For cannot move it.
import type { RateLimits } from '../config.js'

const WINDOW_MS = 60_000

export interface RateLimiter {
  /** Counts one request; false once either limit for the current window is spent. */
  take(key: string): boolean
}

export function createRateLimiter(limits: RateLimits, now: () => number = Date.now): RateLimiter {
  let windowStart = now()
  let total = 0
  const perKey = new Map<string, number>()
  return {
    take(key) {
      const at = now()
      if (at - windowStart >= WINDOW_MS) {
        windowStart = at
        total = 0
        perKey.clear()
      }
      const used = perKey.get(key) ?? 0
      if (used >= limits.perIpPerMinute || total >= limits.globalPerMinute) return false
      perKey.set(key, used + 1)
      total += 1
      return true
    },
  }
}
