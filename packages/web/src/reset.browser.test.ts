import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import Ajv2020 from 'ajv/dist/2020.js'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ST-5 in a real browser: the screen served by Vite, the IF-2 route answered by page.route()
// with bodies validated against the contract first. Skips cleanly where no Chromium is
// installed; the static and unit tests in reset.test.tsx still run.
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
const phoneMessage = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const phoneMissing: Reply = { status: 400, body: { error: 'validation', fields: { phone: [phoneMessage] } } }

function media(status: number): string {
  return Object.keys(responses[String(status)].content)[0]
}

function assertContract({ status, body }: Reply) {
  const ref = responses[String(status)].content[media(status)].schema.$ref
  expect(ajv.validate({ $ref: `IF-2${ref}` }, body), `IF-2 ${status} ${JSON.stringify(body)}`).toBe(true)
}

const jane = ['Jane', 'Doe', 'jane.doe@example.com', '4155550132'] as const
const traces = ['Jane', 'jane.doe@example.com', '4155550132'] as const
const ids = ['firstName', 'lastName', 'email', 'phone'] as const
const widths = [320, 768, 1280] as const
const cleared = 'Form cleared for the next visitor'

let server: ViteDevServer
let origin: string
let browser: Browser

interface Screen {
  readonly page: Page
  readonly context: BrowserContext
  /** Every request the page made, as "resourceType METHOD url". */
  readonly requests: string[]
}

/** Opens the screen with /api/registrations answering each reply in turn (the last one repeats). */
async function open(
  replies: readonly Reply[] = [created],
  { width = 1280, reducedMotion = 'no-preference' as 'reduce' | 'no-preference' } = {},
): Promise<Screen> {
  replies.forEach(assertContract)
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion })
  const page = await context.newPage()
  const requests: string[] = []
  page.on('request', (request) => requests.push(`${request.resourceType()} ${request.method()} ${request.url()}`))
  let answered = 0
  await page.route('**/api/registrations', (route) => {
    const reply = replies[Math.min(answered++, replies.length - 1)]
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

const submitButton = (page: Page) => page.locator('button[type="submit"]')
const resetButton = (page: Page) => page.getByRole('button', { name: 'Register another visitor' })
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '')
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '')

/** Registers Jane and waits for her confirmation, focus on its heading. */
async function register(page: Page) {
  await fill(page)
  await submitButton(page).click()
  await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
  await expect.poll(() => focusedText(page)).toBe('Thank you, Jane!')
}

/** Waits until the polite status region says the form was cleared. */
async function announced(page: Page) {
  await expect.poll(() => page.getByText(cleared, { exact: true }).count()).toBe(1)
}

/** Activates "Register another visitor" from the keyboard and waits for the cleared form. */
async function registerAnother(page: Page) {
  await page.keyboard.press('Tab')
  await expect.poll(() => focusedText(page)).toBe('Register another visitor')
  await page.keyboard.press('Enter')
  await page.locator('#firstName').waitFor()
  await expect.poll(() => focusedId(page)).toBe('firstName')
  await announced(page)
}

async function expectCleanForm(page: Page) {
  for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
  expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
  expect(await page.locator('[id$="-error"]').count()).toBe(0)
  expect(await page.getByRole('alert').count()).toBe(0)
  expect(await page.getByText('Thank you').count()).toBe(0)
  expect(await page.getByRole('heading').allInnerTexts()).toEqual(['Visitor registration'])
}

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
      expect(await focusedId(page)).toBe('confirmation-title')
      await page.keyboard.press('Tab')
      await expect.poll(() => focusedText(page)).toBe('Register another visitor')
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')
      expect(await page.getByRole('button').count()).toBe(1)
      expect(await page.locator('button, [role="button"]').count()).toBe(1)
      expect(await page.getByRole('button').innerText()).toBe('Register another visitor')
      // Besides the heading and the sentence, the only other thing on the screen is the silent status region.
      expect(await page.getByRole('status').textContent()).toBe('')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The form comes back without a page reload @story:ST-5 @criterion:AC-2', () => {
    it('Given the confirmation is shown and the Network panel is recording, When I activate "Register another visitor", Then the registration form is shown And no new page request was made', async () => {
      const { page, context, requests } = await open()
      await page.evaluate(() => Object.assign(window, { sameDocument: true }))
      await register(page)
      const before = requests.length
      await resetButton(page).click()
      await page.getByRole('heading', { name: 'Visitor registration' }).waitFor()
      await announced(page)
      expect(await page.locator('form').count()).toBe(1)
      expect(await page.locator('input').count()).toBe(4)
      expect(await submitButton(page).innerText()).toBe('Submit')
      // The same document is still loaded: nothing was requested, least of all a page.
      expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true)
      const after = requests.slice(before).filter((request) => !request.endsWith('/favicon.ico'))
      expect(after.filter((request) => request.startsWith('document '))).toEqual([])
      expect(after).toEqual([])
      expect(page.url()).toBe(`${origin}/`)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then all four inputs are blank And no field error, summary box, alert or "Thank you" heading is shown And the cursor is in "First name" And a screen reader announces "Form cleared for the next visitor"', async () => {
      const { page, context } = await open()
      await register(page)
      // The polite region is already in the page before the reset, so the words are announced, not missed.
      expect(await page.getByRole('status').count()).toBe(1)
      expect(await page.getByRole('status').textContent()).toBe('')
      await registerAnother(page)
      await expectCleanForm(page)
      expect(await page.getByRole('status').count()).toBe(1)
      expect(await page.getByRole('status').textContent()).toBe(cleared)
      expect(await page.getByRole('status').getAttribute('class')).toContain('sr-only')
      await expect.poll(() => page.title()).toBe('Visitor registration')
      await context.close()
    }, 60_000)

    it('the next visitor starts typing and the announcement goes quiet; their own Submit shows "Submitting…" alone', async () => {
      const { page, context } = await open()
      await register(page)
      await registerAnother(page)
      await page.keyboard.type('M')
      expect(await page.locator('#firstName').inputValue()).toBe('M')
      expect(await page.getByText(cleared).count()).toBe(0)
      await fill(page, ['Max', 'Roe', 'max.roe@example.com', '4155550133'])
      await submitButton(page).click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      expect(await page.getByText(cleared).count()).toBe(0)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane first pressed Submit with an empty phone and saw its error And she then registered successfully, When she activates "Register another visitor", Then no field error and no summary box is shown', async () => {
      const { page, context } = await open([phoneMissing, created])
      await fill(page, ['Jane', 'Doe', 'jane.doe@example.com', ''])
      await submitButton(page).click()
      await expect.poll(() => focusedId(page)).toBe('phone')
      expect(await page.locator('#phone-error').innerText()).toBe(phoneMessage)
      await page.fill('#phone', '4155550132')
      await submitButton(page).click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await expect.poll(() => focusedText(page)).toBe('Thank you, Jane!')
      await registerAnother(page)
      await expectCleanForm(page)
      expect(await page.getByText(phoneMessage).count()).toBe(0)
      await context.close()
    }, 60_000)
  })

  describe("Scenario: The previous visitor's details leave no trace on the kiosk @story:ST-5 @criterion:AC-4", () => {
    it('Given Jane has registered and pressed "Register another visitor", When the next visitor checks the URL, the tab title and the Back button And browser storage and cookies are inspected in devtools, Then none of them contains "Jane", "jane.doe@example.com" or "4155550132"', async () => {
      const { page, context } = await open()
      const historyLength = await page.evaluate(() => window.history.length)
      await register(page)
      await registerAnother(page)
      await expect.poll(() => page.title()).toBe('Visitor registration')
      const kiosk = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        history: window.history.length,
        state: JSON.stringify(window.history.state),
        local: JSON.stringify({ ...localStorage }),
        localLength: localStorage.length,
        session: JSON.stringify({ ...sessionStorage }),
        sessionLength: sessionStorage.length,
        cookie: document.cookie,
        page: document.documentElement.outerHTML,
        values: [...document.querySelectorAll('input')].map((input) => input.value).join('|'),
      }))
      expect(kiosk).toMatchObject({
        url: `${origin}/`,
        title: 'Visitor registration',
        history: historyLength,
        state: 'null',
        local: '{}',
        localLength: 0,
        session: '{}',
        sessionLength: 0,
        cookie: '',
        values: '|||',
      })
      const cookies = await context.cookies()
      expect(cookies).toEqual([])
      for (const value of traces) {
        for (const [where, text] of Object.entries(kiosk)) expect(String(text), where).not.toContain(value)
      }
      // Back leaves the kiosk page for where the browser started; it never returns to Jane's confirmation.
      await page.goBack()
      expect(page.url()).not.toContain(origin)
      for (const value of traces) {
        expect(page.url()).not.toContain(value)
        expect(await page.content()).not.toContain(value)
      }
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
        await registerAnother(page)
        expect(await page.getByRole('status').textContent()).toBe(cleared)
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
