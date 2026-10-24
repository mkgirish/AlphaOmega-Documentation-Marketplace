import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './csp.js'
import { securityHeaders } from './headers.js'

describe('Scenario: The page relies on nothing outside the container @story:ST-1 @criterion:AC-7', () => {
  it("the page response carries a Content-Security-Policy with \"script-src 'self'\" — the same policy as the built page's <meta>", () => {
    expect(securityHeaders['Content-Security-Policy']).toBe(contentSecurityPolicy)
    expect(securityHeaders['Content-Security-Policy'].split('; ')).toContain("script-src 'self'")
  })

  it('the response leaks nothing to other sites and cannot be framed or sniffed', () => {
    expect(securityHeaders).toEqual({
      'Content-Security-Policy': contentSecurityPolicy,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    })
  })
})
