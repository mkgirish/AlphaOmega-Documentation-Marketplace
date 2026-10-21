import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import { contentSecurityPolicy, cspMetaPlugin } from './csp.js'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const indexHtml = readFileSync(join(webRoot, 'index.html'), 'utf8')
const directives = contentSecurityPolicy.split('; ')

describe('Scenario: The page relies on nothing outside the container @AC-7', () => {
  it("the policy limits scripts, and everything else, to 'self'", () => {
    expect(directives).toContain("script-src 'self'")
    expect(directives).toContain("default-src 'self'")
    expect(directives).toContain("connect-src 'self'")
    expect(directives).toContain("style-src 'self'")
    expect(directives).toContain("object-src 'none'")
    expect(directives).toContain("base-uri 'none'")
    expect(directives).toContain("form-action 'self'")
    expect(contentSecurityPolicy).not.toContain('unsafe-')
    expect(contentSecurityPolicy).not.toContain('http')
    expect(contentSecurityPolicy).not.toContain('*')
  })

  it('the plugin adds the policy as the first element of <head>, at build time only', () => {
    const plugin = cspMetaPlugin()
    expect(plugin.apply).toBe('build')
    const out = plugin.transformIndexHtml('<html><head><title>t</title></head></html>')
    expect(out).toBe(
      `<html><head><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" /><title>t</title></head></html>`,
    )
  })

  it('the plugin refuses a page without a <head>, rather than shipping it unprotected', () => {
    expect(() => cspMetaPlugin().transformIndexHtml('<html></html>')).toThrow()
  })

  it('the source page is titled "Visitor registration" and references nothing off-origin', () => {
    expect(indexHtml).toContain('<html lang="en">')
    expect(indexHtml).toContain('<title>Visitor registration</title>')
    expect(indexHtml).not.toContain('http:')
    expect(indexHtml).not.toContain('https:')
    expect(indexHtml).not.toContain('//')
    expect(indexHtml.split('<script').length - 1).toBe(1)
    expect(indexHtml).toContain('<script type="module" src="/src/main.tsx"></script>')
  })

  describe('the built bundle', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'web-build-'))
    afterAll(() => rmSync(outDir, { recursive: true, force: true }))

    it('carries the CSP, has no inline script or style, and requests only same-origin paths', async () => {
      await build({
        root: webRoot,
        configFile: join(webRoot, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
      })
      const html = readFileSync(join(outDir, 'index.html'), 'utf8')
      expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`)
      expect(html).toContain('<title>Visitor registration</title>')
      expect(html).not.toContain('<style')
      expect(html).not.toContain('style=')
      for (const script of html.split('<script').slice(1)) {
        expect(script.slice(0, script.indexOf('>'))).toContain('src="/assets/')
        expect(script.slice(script.indexOf('>') + 1, script.indexOf('</script>'))).toBe('')
      }
      expect(html).toContain('rel="stylesheet"')

      const assets = readdirSync(join(outDir, 'assets'))
      expect(assets.some((name) => name.endsWith('.js'))).toBe(true)
      expect(assets.some((name) => name.endsWith('.css'))).toBe(true)
      for (const name of assets.filter((asset) => asset.endsWith('.css'))) {
        const sheet = readFileSync(join(outDir, 'assets', name), 'utf8')
        expect(sheet).not.toContain('@import url(')
        expect(sheet).not.toContain('url(http')
        expect(sheet).not.toContain('url(//')
        // AC-5 and AC-6: the card cap and the focus ring really are generated.
        expect(sheet).toContain('max-width:480px')
        expect(sheet).toContain('outline-color:var(--color-focus)')
      }
      for (const name of assets.filter((asset) => asset.endsWith('.js'))) {
        const code = readFileSync(join(outDir, 'assets', name), 'utf8')
        expect(code).not.toContain('localStorage')
        expect(code).not.toContain('sessionStorage')
        expect(code).not.toContain('document.cookie')
        expect(code).not.toContain('fonts.googleapis')
      }
    }, 60_000)
  })
})
