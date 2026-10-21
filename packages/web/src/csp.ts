// AC-7 — the page may load and call nothing outside its own origin. The built index.html
// carries the policy as a <meta>; it is added at build time only, because the dev server's
// React refresh preamble is an inline script.

export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

export function cspMetaPlugin() {
  return {
    name: 'registration-csp-meta',
    apply: 'build' as const,
    transformIndexHtml(html: string): string {
      if (!html.includes('<head>')) throw new Error('index.html has no <head> to carry the Content-Security-Policy')
      return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`)
    },
  }
}
