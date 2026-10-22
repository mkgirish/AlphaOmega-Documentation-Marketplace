// The IF-2 rate limits: fixed one-minute windows per client IP and for all clients together.
// The key is the socket address (trustProxy is off), so X-Forwarded-For cannot shift it, and
// the per-IP counts are dropped when the window rolls, so memory stays bounded.
import type { RateLimits } from '../config.js'

const WINDOW_MS = 60_000

export interface RateLimiter {
  /** Counts one request for key; false when it is over either limit. */
  take(key: string): boolean
}

export function createRateLimiter(limits: RateLimits, now: () => Date): RateLimiter {
  let windowStart = now().getTime()
  let total = 0
  const perKey = new Map<string, number>()
  return {
    take(key) {
      const at = now().getTime()
      if (at - windowStart >= WINDOW_MS) {
        windowStart = at
        total = 0
        perKey.clear()
      }
      // A refused request is not counted, so one client over its own limit cannot spend
      // the global budget, and no new key is stored once the global limit is reached.
      if (total >= limits.globalPerMin) return false
      const count = (perKey.get(key) ?? 0) + 1
      if (count > limits.perIpPerMin) return false
      perKey.set(key, count)
      total += 1
      return true
    },
  }
}
