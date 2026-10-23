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
// Chromium is installed; reset.test.tsx still checks the transition and both screens.
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
const phoneRejected: Reply = { status: 400, body: { error: 'validation', fields: { phone: [phoneMessage] } } }

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
  /** Every request the page made. */
  readonly requests: { method: string; url: string; type: string }[]
  /** Holds the next reply until the returned function lets it go. */
  readonly holdNext: () => () => void
}

/** Opens the screen with /api/registrations answering each POST with the next reply in turn. */
async function open(
  replies: readonly Reply[],
  { width = 1280, reducedMotion = 'no-preference' as 'reduce' | 'no-preference' } = {},
): Promise<Screen> {
  replies.forEach(assertContract)
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion })
  const page = await context.newPage()
  const requests: Screen['requests'] = []
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url(), type: request.resourceType() }))
  let answered = 0
  let held: Promise<void> = Promise.resolve()
  const holdNext = () => {
    let release = () => undefined as void
    held = new Promise<void>((resolve) => (release = resolve))
    return () => release()
  }
  await page.route('**/api/registrations', async (route) => {
    await held
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
  await expect.poll(() => page.evaluate(() => document.activeElement?.id), { timeout: 5_000 }).toBe('firstName')
  return { page, context, requests, holdNext }
}

async function fill(page: Page, values: readonly string[] = jane) {
  for (const [index, id] of ids.entries()) await page.fill(`#${id}`, values[index])
}

/** Registers Jane and waits for the thanks, with focus on its heading. */
async function register(page: Page) {
  await fill(page)
  await page.locator('button[type="submit"]').click()
  await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
  await expect.poll(() => focusedId(page), { timeout: 5_000 }).toBe('confirmation-title')
}

const anotherVisitor = (page: Page) => page.getByRole('button', { name: 'Register another visitor' })
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '')
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '')
/** The polite region's text, or null when there is none — read without waiting for it to appear. */
const statusText = (page: Page) => page.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? null)

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
      const { page, context } = await open([created])
      await register(page)
      expect(await focusedText(page)).toBe('Thank you, Jane!')
      await page.keyboard.press('Tab')
      expect(await focusedText(page)).toBe('Register another visitor')
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')
      expect(await page.getByRole('button').count()).toBe(1)
      expect(await page.locator('button, [role="button"], input[type="button"], input[type="submit"]').count()).toBe(1)
      // The polite region that will announce the reset is already in place, and silent.
      expect(await page.getByRole('status').count()).toBe(1)
      expect(await statusText(page)).toBe('')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The form comes back without a page reload @story:ST-5 @criterion:AC-2', () => {
    it('Given the confirmation is shown and the Network panel is recording, When I activate "Register another visitor", Then the registration form is shown And no new page request was made', async () => {
      const { page, context, requests } = await open([created])
      await page.evaluate(() => Object.assign(window, { sameDocument: true }))
      await register(page)
      const before = requests.length
      await anotherVisitor(page).focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: 'Visitor registration' }).waitFor()
      await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe(cleared)
      expect(await page.locator('form').count()).toBe(1)
      expect(await page.locator('input').count()).toBe(4)
      expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true)
      // The browser may ask for a favicon on its own; the reset itself requests nothing.
      expect(requests.slice(before).filter((request) => !request.url.endsWith('/favicon.ico'))).toEqual([])
      expect(requests.filter((request) => request.type === 'document')).toHaveLength(1)
      expect(page.url()).toBe(`${origin}/`)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then all four inputs are blank, no error, summary, alert or "Thank you" shows, the cursor is in "First name" and a screen reader announces "Form cleared for the next visitor"', async () => {
      const { page, context } = await open([created])
      await register(page)
      await anotherVisitor(page).click()
      await expect.poll(() => focusedId(page), { timeout: 5_000 }).toBe('firstName')
      for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
      expect(await page.locator('[id$="-error"]').count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(await page.getByText('Thank you').count()).toBe(0)
      expect(await page.getByRole('heading').allInnerTexts()).toEqual(['Visitor registration'])
      await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe(cleared)
      expect(await page.getByRole('status').getAttribute('class')).toContain('sr-only')
      // The next visitor types straight away, and the screen behaves as when first opened.
      await page.keyboard.type('Ann')
      expect(await page.locator('#firstName').inputValue()).toBe('Ann')
      expect(await page.locator('button[type="submit"]').innerText()).toBe('Submit')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane registered and the form was cleared, When the next visitor saves slowly and is then cleared too, Then only "Submitting…" speaks while saving and the second reset is announced again', async () => {
      const { page, context, holdNext } = await open([
        created,
        { status: 201, body: { firstName: 'Ann', createdAt: '2026-10-20T14:09:51Z' } },
      ])
      await register(page)
      await anotherVisitor(page).click()
      await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe(cleared)
      await fill(page, ['Ann', 'Lee', 'ann.lee@example.com', '4155550199'])
      const release = holdNext()
      await page.locator('button[type="submit"]').click()
      await expect.poll(() => page.locator('button[type="submit"]').innerText(), { timeout: 5_000 }).toBe('Submitting…')
      expect(await page.locator('[role="status"]').allInnerTexts()).toEqual(['Submitting…'])
      expect(await focusedText(page)).toBe('Submitting…')
      release()
      await page.getByRole('heading', { name: 'Thank you, Ann!' }).waitFor()
      await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe('')
      expect(await page.getByRole('button').count()).toBe(1)
      await anotherVisitor(page).click()
      await expect.poll(() => focusedId(page), { timeout: 5_000 }).toBe('firstName')
      await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe(cleared)
      for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane first pressed Submit with an empty phone and saw its error, And she then registered successfully, When she activates "Register another visitor", Then no field error and no summary box is shown', async () => {
      const { page, context } = await open([phoneRejected, created])
      await fill(page, ['Jane', 'Doe', 'jane.doe@example.com', ''])
      await page.locator('button[type="submit"]').click()
      await expect.poll(() => focusedId(page), { timeout: 5_000 }).toBe('phone')
      expect(await page.locator('#phone-error').innerText()).toBe(phoneMessage)
      await page.fill('#phone', '4155550132')
      await page.locator('button[type="submit"]').click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await anotherVisitor(page).click()
      await expect.poll(() => focusedId(page), { timeout: 5_000 }).toBe('firstName')
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
      expect(await page.locator('#phone-error').count()).toBe(0)
      expect(await page.getByText(phoneMessage).count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
      await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe(cleared)
      await context.close()
    }, 60_000)
  })

  describe("Scenario: The previous visitor's details leave no trace on the kiosk @story:ST-5 @criterion:AC-4", () => {
    it('Given Jane has registered and pressed "Register another visitor", When the next visitor checks the URL, the tab title and the Back button, And browser storage and cookies are inspected, Then none of them contains "Jane", "jane.doe@example.com" or "4155550132"', async () => {
      const { page, context } = await open([created])
      const historyLength = await page.evaluate(() => window.history.length)
      await register(page)
      expect(await page.title()).toBe('Registration complete')
      await anotherVisitor(page).click()
      await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe(cleared)
      await expect.poll(() => page.title(), { timeout: 5_000 }).toBe('Visitor registration')
      const kiosk = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        history: window.history.length,
        state: JSON.stringify(window.history.state),
        local: JSON.stringify({ ...localStorage }),
        session: JSON.stringify({ ...sessionStorage }),
        cookie: document.cookie,
        text: document.body.innerText,
        inputs: [...document.querySelectorAll('input')].map((input) => input.value).join(''),
      }))
      expect(kiosk).toEqual({
        url: `${origin}/`,
        title: 'Visitor registration',
        history: historyLength,
        state: 'null',
        local: '{}',
        session: '{}',
        cookie: '',
        text: expect.any(String),
        inputs: '',
      })
      for (const value of jane) expect(JSON.stringify(kiosk)).not.toContain(value)
      expect(await context.cookies()).toEqual([])
      // Back leaves the screen for the page before it — there is no entry holding Jane's confirmation.
      const back = await page.goBack()
      if (back !== null || page.url() !== `${origin}/`) expect(page.url()).not.toContain(origin)
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
        expect(await axeViolations(page)).toEqual([])
        await anotherVisitor(page).click()
        await expect.poll(() => focusedId(page), { timeout: 5_000 }).toBe('firstName')
        await expect.poll(() => statusText(page), { timeout: 5_000 }).toBe(cleared)
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
