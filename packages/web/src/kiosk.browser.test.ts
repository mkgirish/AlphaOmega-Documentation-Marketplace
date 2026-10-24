import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright'
import { build, preview, type PreviewServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { securityHeaders } from './headers.js'

// ST-1 in a real browser: the built bundle, served by `vite preview` with the web package's
// own headers and nothing else running — no API, no mock, no route stubs. Skips cleanly
// where no Chromium is installed; the static and unit tests still run.
const webRoot = fileURLToPath(new URL('..', import.meta.url))

function findChromium(): string | undefined {
  const bundled = chromium.executablePath()
  if (existsSync(bundled)) return bundled
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  for (const dir of readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse()) {
    for (const binary of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      if (existsSync(join(root, dir, binary))) return join(root, dir, binary)
    }
  }
  return undefined
}

const executablePath = findChromium()
// A browser that is present but cannot start (missing system libraries) skips the suite too.
const launches =
  executablePath !== undefined &&
  (await chromium.launch({ executablePath }).then(
    (probe) => probe.close().then(() => true),
    () => false,
  ))

const fields = [
  { id: 'firstName', label: 'First name' },
  { id: 'lastName', label: 'Last name' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone number' },
] as const
const tabOrder = ['lastName', 'email', 'phone', 'submit'] as const
const widths = [360, 768, 1920] as const

let outDir: string
let server: PreviewServer
let origin: string
let browser: Browser

interface Screen {
  readonly page: Page
  readonly context: BrowserContext
  /** The response to the page request itself. */
  readonly response: Response
  /** Every URL the page requested. */
  readonly requests: string[]
  /** Every Content-Security-Policy violation the page reported. */
  readonly violations: string[]
}

/** Opens http://<preview>/ as a fresh kiosk browser at the given width. */
async function open({ width = 1920, reducedMotion = 'no-preference' as 'reduce' | 'no-preference' } = {}): Promise<Screen> {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion })
  const page = await context.newPage()
  const requests: string[] = []
  const violations: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  const response = await page.goto(`${origin}/`)
  if (!response) throw new Error('the page answered nothing')
  await page.locator('#firstName').waitFor()
  return { page, context, response, requests, violations }
}

const focusedId = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement
    if (!active || active === document.body) return 'body'
    return active.id || (active instanceof HTMLButtonElement && active.type === 'submit' ? 'submit' : active.tagName)
  })

/** Every WCAG violation axe reports, at any impact. */
async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze()
  return results.violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.help}`)
}

describe.skipIf(!launches)('Feature: Open the registration screen at the lobby kiosk from one container', () => {
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'web-kiosk-'))
    await build({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    server = await preview({
      root: webRoot,
      configFile: join(webRoot, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir },
      preview: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('vite preview did not report a port')
    origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ executablePath })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>((resolve) => (server ? server.httpServer.close(() => resolve()) : resolve()))
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  describe('Scenario: One container serves the screen with nothing else running @story:ST-1 @criterion:AC-1', () => {
    it('Given only the built screen is served, When I open it, Then the page shows the heading "Visitor registration"', async () => {
      const { page, context, response } = await open()
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('text/html')
      expect(await page.getByRole('heading', { level: 1 }).allInnerTexts()).toEqual(['Visitor registration'])
      expect(await page.title()).toBe('Visitor registration')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The form shows exactly the four visitor fields @story:ST-1 @criterion:AC-2', () => {
    it('Given the registration screen is open, When I look at the form, Then I see the four inputs, each marked required, the phone hint and one Submit button', async () => {
      const { page, context } = await open()
      await expect.poll(() => page.locator('main p').first().innerText()).toBe('Please register. All fields are required.')
      expect(await page.locator('input').count()).toBe(4)
      for (const field of fields) {
        const input = page.getByLabel(field.label, { exact: true })
        expect(await input.getAttribute('id')).toBe(field.id)
        expect(await input.evaluate((element) => (element as HTMLInputElement).required)).toBe(true)
      }
      const phone = page.getByLabel('Phone number', { exact: true })
      const hint = page.locator(`#${await phone.getAttribute('aria-describedby')}`)
      expect(await hint.innerText()).toBe('10-digit US number, e.g. (415) 555-0132')
      const [phoneBox, hintBox] = [await phone.boundingBox(), await hint.boundingBox()]
      expect(hintBox!.y).toBeGreaterThanOrEqual(phoneBox!.y + phoneBox!.height)
      expect(await page.getByRole('button').allInnerTexts()).toEqual(['Submit'])
      await context.close()
    }, 60_000)
  })

  describe('Scenario: There is nowhere else to go @story:ST-1 @criterion:AC-3', () => {
    it('Given the registration screen is open, When I look for links or navigation on the page, Then I find none', async () => {
      const { page, context } = await open()
      expect(
        await page.locator('a, body [href], nav, menu, [role="link"], [role="navigation"], [role="menu"], [role="menubar"]').count(),
      ).toBe(0)
      expect(await page.getByRole('link').count()).toBe(0)
      expect(await page.getByRole('navigation').count()).toBe(0)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: No admin or listing page can be reached @story:ST-1 @criterion:AC-3', () => {
    it('Given the screen is served, When I request /admin and GET /api/registrations, Then neither returns a page or stored data and both answer 404 or 405', async () => {
      for (const path of ['/admin', '/admin/', '/api/registrations']) {
        const response = await fetch(`${origin}${path}`, { headers: { Accept: 'text/html,application/json' } })
        const body = await response.text()
        expect([404, 405], `GET ${path}`).toContain(response.status)
        expect(body, `GET ${path}`).not.toContain('<html')
        expect(body, `GET ${path}`).not.toContain('Visitor registration')
        expect(body, `GET ${path}`).not.toContain('firstName')
      }
    })
  })

  describe('Scenario: The first visitor sees an empty, calm form @story:ST-1 @criterion:AC-4', () => {
    it('Given the screen has just been served, When I open it, Then all four inputs are blank, nothing is flagged and the cursor is in "First name"', async () => {
      const { page, context } = await open()
      for (const field of fields) expect(await page.locator(`#${field.id}`).inputValue()).toBe('')
      expect(await page.locator('[role="alert"], [role="status"], [aria-live], [aria-invalid="true"], [id$="-error"]').count()).toBe(0)
      await expect.poll(() => focusedId(page)).toBe('firstName')
      await context.close()
    }, 60_000)

    it('and the kiosk holds nothing of anyone: no storage, no cookie, no history state and a bare URL', async () => {
      const { page, context } = await open()
      expect(page.url()).toBe(`${origin}/`)
      expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie, history.state])).toEqual([
        0,
        0,
        '',
        null,
      ])
      expect(await context.cookies()).toEqual([])
      await context.close()
    }, 60_000)
  })

  describe('Scenario Outline: The form fits kiosk, tablet and narrow screens @story:ST-1 @criterion:AC-5', () => {
    for (const width of widths) {
      it(`Given the browser viewport is ${width} pixels wide, When I open the screen, Then every input and Submit are visible without horizontal scrolling and the card is no wider than 480 pixels`, async () => {
        const { page, context } = await open({ width })
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          card: document.getElementById('registration-card')!.getBoundingClientRect().width,
          controls: [...document.querySelectorAll('input, button')].map((control) => {
            const box = control.getBoundingClientRect()
            return { left: box.left, right: box.right, width: box.width }
          }),
        }))
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
        expect(layout.clientWidth).toBe(width)
        expect(layout.card).toBeLessThanOrEqual(480)
        expect(layout.controls).toHaveLength(5)
        for (const control of layout.controls) {
          expect(control.left).toBeGreaterThanOrEqual(0)
          expect(control.right).toBeLessThanOrEqual(width)
          expect(control.width).toBeGreaterThan(0)
        }
        for (const field of fields) expect(await page.locator(`#${field.id}`).isVisible()).toBe(true)
        expect(await page.getByRole('button', { name: 'Submit' }).isVisible()).toBe(true)
        await context.close()
      }, 60_000)
    }
  })

  describe('Scenario: A keyboard-only visitor can reach every control in order @story:ST-1 @criterion:AC-6', () => {
    for (const width of widths) {
      it(`Given focus is in "First name" at ${width} px, When I press Tab four times, Then focus moves through Last name, Email, Phone number and Submit in that order`, async () => {
        const { page, context } = await open({ width })
        await expect.poll(() => focusedId(page)).toBe('firstName')
        for (const expected of tabOrder) {
          await page.keyboard.press('Tab')
          expect(await focusedId(page)).toBe(expected)
        }
        await context.close()
      }, 60_000)
    }

    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      for (const width of widths) {
        it(`And an axe scan of the empty screen at ${width} px ('${reducedMotion}' motion) reports zero violations at any impact`, async () => {
          const { page, context } = await open({ width, reducedMotion })
          expect(await axeViolations(page)).toEqual([])
          await context.close()
        }, 60_000)
      }
    }
  })

  describe('Scenario: The page relies on nothing outside the container @story:ST-1 @criterion:AC-7', () => {
    it("Given the network is recorded, When I open the screen, Then every request goes to the page's origin and the response has a CSP with \"script-src 'self'\"", async () => {
      const { page, context, response, requests, violations } = await open()
      await page.waitForLoadState('networkidle')
      expect(requests.length).toBeGreaterThan(1)
      for (const url of requests) expect(new URL(url).origin).toBe(origin)
      const policy = response.headers()['content-security-policy']
      expect(policy).toBe(securityHeaders['Content-Security-Policy'])
      expect(policy.split('; ')).toContain("script-src 'self'")
      expect(response.headers()['x-content-type-options']).toBe('nosniff')
      expect(response.headers()['referrer-policy']).toBe('no-referrer')
      expect(violations).toEqual([])
      await context.close()
    }, 60_000)
  })
})
