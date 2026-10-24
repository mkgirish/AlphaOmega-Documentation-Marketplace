import { contentSecurityPolicy } from './csp.js'

// IF-1 — the response headers the registration screen is served with (AC-7). The CSP
// header repeats the built page's <meta> policy, so scripts stay limited to 'self' even
// before the document is parsed; the rest keep the page from leaking anything to others.
export const securityHeaders = {
  'Content-Security-Policy': contentSecurityPolicy,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
} as const
