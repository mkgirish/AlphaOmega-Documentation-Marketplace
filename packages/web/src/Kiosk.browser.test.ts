import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { build, preview, type PreviewServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ST-1 as the kiosk meets it: the built bundle served by `vite preview` exactly as the
// package ships it — Content-Security-Policy header on, no SPA fallback — and opened in
// a real browser. The HTTP checks always run; the browser checks skip cleanly where no
// Chromium is installed (the scaffold's CI ships none).
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

const ids = ['firstName', 'lastName', 'email', 'phone'] as const
const labels = ['First name', 'Last name', 'Email', 'Phone number'] as const
const widths = [360, 768, 1920] as const

const outDir = mkdtempSync(join(tmpdir(), 'web-kiosk-'))
let server: PreviewServer
let origin: string
let browser: Browser | undefined

interface Opened {
  readonly page: Page
  readonly context: BrowserContext
  /** Every URL the page requested. */
  readonly requests: string[]
  /** Every Content-Security-Policy violation the page reported. */
  readonly violations: string[]
  /** The Content-Security-Policy header the page response carried. */
  readonly policy: string | undefined
}

async function open({ width = 1280, reducedMotion = 'no-preference' as 'reduce' | 'no-preference' } = {}): Promise<Opened> {
  if (!browser) throw new Error('no browser')
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion })
  const page = await context.newPage()
  const requests: string[] = []
  const violations: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  const response = await page.goto(`${origin}/`)
  await page.locator('#firstName').waitFor()
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('firstName')
  return { page, context, requests, violations, policy: response?.headers()['content-security-policy'] }
}

const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || '')

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.help}`)
}

beforeAll(async () => {
  await build({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'), logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  server = await preview({
    root: webRoot,
    configFile: join(webRoot, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  })
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('vite preview did not report a port')
  origin = `http://127.0.0.1:${address.port}`
  if (launches) browser = await chromium.launch({ executablePath })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>((resolve) => (server ? server.httpServer.close(() => resolve()) : resolve()))
  rmSync(outDir, { recursive: true, force: true })
})

describe('Feature: Open the registration screen at the lobby kiosk from one container', () => {
  describe('the bundle as served', () => {
    it('Scenario: One container serves the screen @story:ST-1 @criterion:AC-1 — / answers 200 with the titled screen', async () => {
      const response = await fetch(`${origin}/`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      const html = await response.text()
      expect(html).toContain('<title>Visitor registration</title>')
      expect(html).toContain('<div id="root"></div>')
    })

    it.each(['/admin', '/admin/', '/login', '/registrations', '/api/registrations'])(
      'Scenario: No admin or listing page can be reached @story:ST-1 @criterion:AC-3 — GET %s returns no page and no stored data, with 404 or 405',
      async (path) => {
        const response = await fetch(`${origin}${path}`)
        expect([404, 405]).toContain(response.status)
        const body = await response.text()
        expect(body).not.toContain('<div id="root">')
        expect(body).not.toContain('Visitor registration')
        expect(body).not.toContain('@')
      },
    )

    it("Scenario: The page relies on nothing outside the container @story:ST-1 @criterion:AC-7 — the page response carries a policy with script-src 'self'", async () => {
      const response = await fetch(`${origin}/`)
      const policy = response.headers.get('content-security-policy') ?? ''
      const directives = policy.split(';').map((directive) => directive.trim())
      expect(directives).toContain("script-src 'self'")
      expect(directives).toContain("default-src 'self'")
      expect(directives).toContain("connect-src 'self'")
      expect(policy).not.toContain('unsafe-')
    })
  })

  describe.skipIf(!launches)('in the browser', () => {
    describe('Scenario: One container serves the screen with nothing else running @story:ST-1 @criterion:AC-1', () => {
      it('When I open http://localhost:3000/, Then the page shows the heading "Visitor registration"', async () => {
        const { page, context } = await open()
        expect(await page.getByRole('heading', { level: 1 }).allInnerTexts()).toEqual(['Visitor registration'])
        expect(await page.title()).toBe('Visitor registration')
        await context.close()
      }, 60_000)
    })

    describe('Scenario: The form shows exactly the four visitor fields @story:ST-1 @criterion:AC-2', () => {
      it('Given the registration screen is open, When I look at the form, Then I see the four inputs each marked required, the phone hint and exactly one button, "Submit"', async () => {
        const { page, context } = await open()
        expect(await page.locator('#registration-intro').innerText()).toBe('Please register. All fields are required.')
        expect(await page.locator('input, select, textarea').count()).toBe(4)
        for (const [index, label] of labels.entries()) {
          const input = page.getByLabel(label, { exact: true })
          expect(await input.getAttribute('id')).toBe(ids[index])
          expect(await input.evaluate((element) => (element as HTMLInputElement).required)).toBe(true)
        }
        const phone = page.getByLabel('Phone number', { exact: true })
        expect(await phone.evaluate((element) => element.getAttribute('aria-describedby'))).toBe('phone-hint')
        expect(await page.locator('#phone-hint').innerText()).toBe('10-digit US number, e.g. (415) 555-0132')
        const hintBelow = await page.evaluate(
          () =>
            document.getElementById('phone-hint')!.getBoundingClientRect().top >=
            document.getElementById('phone')!.getBoundingClientRect().bottom,
        )
        expect(hintBelow).toBe(true)
        expect(await page.getByRole('button').allInnerTexts()).toEqual(['Submit'])
        await context.close()
      }, 60_000)
    })

    describe('Scenario: There is nowhere else to go @story:ST-1 @criterion:AC-3', () => {
      it('Given the registration screen is open, When I look for links or navigation on the page, Then I find none', async () => {
        const { page, context } = await open()
        expect(
          await page
            .locator('body')
            .locator('a, nav, menu, [role="link"], [role="navigation"], [role="menu"], [role="menubar"], [href]')
            .count(),
        ).toBe(0)
        expect(await page.getByRole('link').count()).toBe(0)
        expect(await page.getByRole('navigation').count()).toBe(0)
        await context.close()
      }, 60_000)
    })

    describe('Scenario: No admin or listing page can be reached @story:ST-1 @criterion:AC-3', () => {
      it('Given the container is running, When I request /admin and GET /api/registrations, Then neither returns a page or a stored registration, and both answer 404 or 405', async () => {
        const { page, context } = await open()
        // Chromium shows its own error page for an empty 404, so the answer is read off the wire.
        const [admin] = await Promise.all([page.waitForResponse(`${origin}/admin`), page.goto(`${origin}/admin`).catch(() => null)])
        expect([404, 405]).toContain(admin.status())
        expect(await page.locator('#root, form, input').count()).toBe(0)
        const listing = await page.request.get(`${origin}/api/registrations`)
        expect([404, 405]).toContain(listing.status())
        expect(await listing.text()).not.toContain('@')
        await context.close()
      }, 60_000)
    })

    describe('Scenario: The first visitor sees an empty, calm form @story:ST-1 @criterion:AC-4', () => {
      it('Given the container has just started, When I open http://localhost:3000/, Then all four inputs are blank, no error, summary or alert shows, and the cursor is in "First name"', async () => {
        const { page, context } = await open()
        for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
        expect(await page.getByRole('alert').count()).toBe(0)
        expect(await page.getByRole('status').count()).toBe(0)
        expect(await page.locator('[aria-invalid="true"], [id$="-error"], [aria-live]').count()).toBe(0)
        expect(await focusedId(page)).toBe('firstName')
        await context.close()
      }, 60_000)
    })

    describe('Scenario Outline: The form fits kiosk, tablet and narrow screens @story:ST-1 @criterion:AC-5', () => {
      it.each(widths)(
        'Given the browser viewport is %i pixels wide, When I open the registration screen, Then every input and Submit are visible without horizontal scrolling and the card is no wider than 480 pixels',
        async (width) => {
          const { page, context } = await open({ width })
          const layout = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
            card: document.getElementById('registration-card')!.getBoundingClientRect().width,
            controls: [...document.querySelectorAll('input, button')].map((control) => {
              const box = control.getBoundingClientRect()
              return { left: box.left, right: box.right, width: box.width }
            }),
          }))
          expect(layout.scroll).toBeLessThanOrEqual(layout.client)
          expect(layout.card).toBeLessThanOrEqual(480)
          expect(layout.controls).toHaveLength(5)
          for (const control of layout.controls) {
            expect(control.width).toBeGreaterThan(0)
            expect(control.left).toBeGreaterThanOrEqual(0)
            expect(control.right).toBeLessThanOrEqual(layout.client)
          }
          for (const id of [...ids]) await expect.poll(() => page.locator(`#${id}`).isVisible()).toBe(true)
          expect(await page.getByRole('button', { name: 'Submit' }).isVisible()).toBe(true)
          await context.close()
        },
        60_000,
      )
    })

    describe('Scenario: A keyboard-only visitor can reach every control in order @story:ST-1 @criterion:AC-6', () => {
      it('Given focus is in "First name", When I press Tab four times, Then focus moves through Last name, Email, Phone number and Submit in that order', async () => {
        const { page, context } = await open()
        const order: string[] = []
        for (let press = 0; press < 4; press++) {
          await page.keyboard.press('Tab')
          order.push(await focusedId(page))
        }
        expect(order).toEqual(['lastName', 'email', 'phone', 'BUTTON'])
        expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Submit')
        await context.close()
      }, 60_000)

      const runs = (['no-preference', 'reduce'] as const).flatMap((reducedMotion) => widths.map((width) => ({ width, reducedMotion })))

      it.each(runs)(
        'And an axe scan of the empty screen at $width px ($reducedMotion motion) reports zero violations of any impact',
        async ({ width, reducedMotion }) => {
          const { page, context } = await open({ width, reducedMotion })
          expect(await axeViolations(page)).toEqual([])
          await context.close()
        },
        60_000,
      )
    })

    describe('Scenario: The page relies on nothing outside the container @story:ST-1 @criterion:AC-7', () => {
      it('Given the Network panel is recording, When I open http://localhost:3000/, Then every request goes to the page’s origin and the response has a policy with "script-src \'self\'"', async () => {
        const { page, context, requests, violations, policy } = await open()
        await page.waitForLoadState('networkidle')
        expect(requests.length).toBeGreaterThan(0)
        for (const url of requests) expect(url.startsWith(`${origin}/`), url).toBe(true)
        expect((policy ?? '').split(';').map((directive) => directive.trim())).toContain("script-src 'self'")
        expect(violations).toEqual([])
        await context.close()
      }, 60_000)
    })
  })
})
