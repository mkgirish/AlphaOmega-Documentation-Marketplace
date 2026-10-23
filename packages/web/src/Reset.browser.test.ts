import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import Ajv2020 from 'ajv/dist/2020.js'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ST-5 in a real browser: the screen served by Vite, the IF-2 route answered by
// page.route() with bodies validated against the contract first. Skips cleanly where no
// Chromium is installed; the static and unit tests still run.
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

const contract = JSON.parse(readFileSync(new URL('./contract/IF-2.json', import.meta.url), 'utf8'))
const responses = contract.paths['/api/registrations'].post.responses
const ajv = new Ajv2020({ strict: false })
ajv.addSchema(contract, 'IF-2')

interface Reply {
  readonly status: number
  readonly body: unknown
}

const created: Reply = { status: 201, body: { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' } }
const phoneMessage = 'Server says: enter the phone number.'
const phoneMissing: Reply = { status: 400, body: { error: 'validation', fields: { phone: [phoneMessage] } } }

function media(status: number): string {
  return Object.keys(responses[String(status)].content)[0]
}

function assertContract({ status, body }: Reply) {
  const ref = responses[String(status)].content[media(status)].schema.$ref
  expect(ajv.validate({ $ref: `IF-2${ref}` }, body), `IF-2 ${status} ${JSON.stringify(body)}`).toBe(true)
}

const jane = ['Jane', 'Doe', 'jane.doe@example.com', '4155550132'] as const
const ids = ['firstName', 'lastName', 'email', 'phone'] as const
const widths = [320, 768, 1280] as const
const cleared = 'Form cleared for the next visitor'

let server: ViteDevServer
let origin: string
let browser: Browser

interface Screen {
  readonly page: Page
  readonly context: BrowserContext
  /** Every request the page made, as "TYPE METHOD url". */
  readonly requests: string[]
}

/** Opens the screen with /api/registrations answering each POST with the next of `replies`. */
async function open(
  replies: readonly Reply[] = [created],
  { width = 1280, reducedMotion = 'no-preference' as 'reduce' | 'no-preference' } = {},
): Promise<Screen> {
  replies.forEach(assertContract)
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion })
  const page = await context.newPage()
  const requests: string[] = []
  page.on('request', (request) => requests.push(`${request.resourceType()} ${request.method()} ${request.url()}`))
  let next = 0
  await page.route('**/api/registrations', (route) => {
    const reply = replies[Math.min(next++, replies.length - 1)]
    return route.fulfill({
      status: reply.status,
      contentType: media(reply.status),
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(reply.body),
    })
  })
  await page.goto(`${origin}/`)
  await page.locator('#firstName').waitFor()
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('firstName')
  return { page, context, requests }
}

async function fill(page: Page, values: readonly string[] = jane) {
  for (const [index, id] of ids.entries()) await page.fill(`#${id}`, values[index])
}

/** Registers Jane and waits for the confirmation, with focus on its heading. */
async function register(page: Page) {
  await fill(page)
  await page.locator('button[type="submit"]').click()
  await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
  await expect.poll(() => focusedId(page)).toBe('confirmation-title')
}

/** Activates "Register another visitor" and waits for the empty form, with focus in First name. */
async function reset(page: Page) {
  await page.getByRole('button', { name: 'Register another visitor' }).press('Enter')
  await page.locator('#firstName').waitFor()
  await expect.poll(() => focusedId(page)).toBe('firstName')
}

const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '')
const statusTexts = (page: Page) => page.locator('[role="status"]').allTextContents()

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.help}`)
}

describe.skipIf(!launches)('Feature: Clear the kiosk for the next visitor', () => {
  beforeAll(async () => {
    server = await createServer({
      root: webRoot,
      configFile: join(webRoot, 'vite.config.ts'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not report a port')
    origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ executablePath })
    // Warm the dev server's transform cache so the first scenario is not timed on compilation.
    const warm = await browser.newPage()
    await warm.goto(`${origin}/`)
    await warm.locator('#firstName').waitFor({ timeout: 120_000 })
    await warm.close()
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  describe('Scenario: The confirmation offers one way forward @story:ST-5 @criterion:AC-1', () => {
    it('Given I have just registered as "Jane", When I press Tab once from the heading "Thank you, Jane!", Then focus is on the button "Register another visitor" And it is the only button on the screen', async () => {
      const { page, context } = await open()
      await register(page)
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Register another visitor')
      expect(await page.getByRole('button').count()).toBe(1)
      expect(await page.locator('button, [role="button"], input[type="button"], input[type="submit"]').count()).toBe(1)
      // The polite status region is already on the page, empty, so the reset is heard when it fills.
      expect(await statusTexts(page)).toEqual([''])
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The form comes back without a page reload @story:ST-5 @criterion:AC-2', () => {
    it('Given the confirmation is shown and the Network panel is recording, When I activate "Register another visitor", Then the registration form is shown And no new page request was made', async () => {
      const { page, context, requests } = await open()
      await register(page)
      await page.evaluate(() => Object.assign(window, { sameDocument: true }))
      const before = requests.length
      await reset(page)
      expect(await page.getByRole('heading', { name: 'Visitor registration' }).count()).toBe(1)
      expect(await page.locator('form input').count()).toBe(4)
      expect(await statusTexts(page)).toEqual([cleared])
      // The browser may ask for a favicon on its own; the reset itself requests nothing.
      expect(requests.slice(before).filter((request) => !request.endsWith('/favicon.ico'))).toEqual([])
      expect(requests.filter((request) => request.startsWith('document '))).toEqual([`document GET ${origin}/`])
      expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true)
      expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then all four inputs are blank And no field error, summary box, alert or "Thank you" heading is shown And the cursor is in "First name" And a screen reader announces "Form cleared for the next visitor"', async () => {
      const { page, context } = await open()
      await register(page)
      await reset(page)
      for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
      expect(await page.locator('[id$="-error"]').count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(await page.getByRole('heading', { name: /Thank you/ }).count()).toBe(0)
      expect(await focusedId(page)).toBe('firstName')
      const status = page.locator('[role="status"]')
      expect(await status.count()).toBe(1)
      expect(await status.textContent()).toBe(cleared)
      expect(await status.getAttribute('aria-live')).not.toBe('off')
      expect(await status.getAttribute('aria-hidden')).toBeNull()
      expect(await page.locator('button[type="submit"]').innerText()).toBe('Submit')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane first pressed Submit with an empty phone and saw its error And she then registered successfully, When she activates "Register another visitor", Then no field error and no summary box is shown', async () => {
      const { page, context } = await open([phoneMissing, created])
      await fill(page, ['Jane', 'Doe', 'jane.doe@example.com', ''])
      await page.locator('button[type="submit"]').click()
      await page.locator('#phone-error').waitFor()
      expect(await page.locator('#phone-error').innerText()).toBe(phoneMessage)
      await page.fill('#phone', jane[3])
      await page.locator('button[type="submit"]').click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await reset(page)
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
      expect(await page.locator('[id$="-error"]').count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(await page.locator('#registration-card').innerText()).not.toContain(phoneMessage)
      expect(await statusTexts(page)).toEqual([cleared])
      await context.close()
    }, 60_000)
  })

  describe("Scenario: The previous visitor's details leave no trace on the kiosk @story:ST-5 @criterion:AC-4", () => {
    it('Given Jane has registered and pressed "Register another visitor", When the next visitor checks the URL, the tab title and the Back button And browser storage and cookies are inspected in devtools, Then none of them contains "Jane", "jane.doe@example.com" or "4155550132"', async () => {
      const { page, context } = await open()
      const historyLength = await page.evaluate(() => window.history.length)
      await register(page)
      await reset(page)
      expect(await statusTexts(page)).toEqual([cleared])
      await expect.poll(() => page.title()).toBe('Visitor registration')
      const trace = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        history: window.history.length,
        state: JSON.stringify(window.history.state),
        local: JSON.stringify(Object.entries(localStorage)),
        session: JSON.stringify(Object.entries(sessionStorage)),
        cookie: document.cookie,
        page: document.documentElement.outerHTML,
      }))
      expect(trace.url).toBe(`${origin}/`)
      expect(trace.title).toBe('Visitor registration')
      expect(trace.history).toBe(historyLength)
      expect(trace.state).toBe('null')
      expect(trace.local).toBe('[]')
      expect(trace.session).toBe('[]')
      expect(trace.cookie).toBe('')
      expect(await context.cookies()).toEqual([])
      const everywhere = JSON.stringify(trace)
      for (const value of ['Jane', 'jane.doe@example.com', '4155550132', 'Doe']) expect(everywhere).not.toContain(value)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The reset form is accessible @story:ST-5 @criterion:AC-5', () => {
    const runs = (['no-preference', 'reduce'] as const).flatMap((reducedMotion) => widths.map((width) => ({ width, reducedMotion })))

    it.each(runs)(
      'Given the form has just been reset at $width px ($reducedMotion motion), When an axe scan runs, Then it reports zero violations',
      async ({ width, reducedMotion }) => {
        const { page, context } = await open([created], { width, reducedMotion })
        await register(page)
        await reset(page)
        expect(await statusTexts(page)).toEqual([cleared])
        expect(await axeViolations(page)).toEqual([])
        const layout = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          card: document.getElementById('registration-card')?.getBoundingClientRect().width ?? 0,
        }))
        expect(layout.scroll, `width ${width}`).toBeLessThanOrEqual(layout.client)
        expect(layout.card, `width ${width}`).toBeLessThanOrEqual(480)
        await context.close()
      },
      60_000,
    )
  })
})
