import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fieldMessages } from '@app/shared'
import AxeBuilder from '@axe-core/playwright'
import Ajv2020 from 'ajv/dist/2020.js'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ST-5 in a real browser: the screen served by Vite, the IF-2 route answered by
// page.route() with bodies validated against the contract first. Skips cleanly where no
// Chromium is installed or can start; the static and unit tests in reset.test.tsx still run.
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
const phoneMissing: Reply = { status: 400, body: { error: 'validation', fields: { phone: [fieldMessages.phone.required] } } }

const media = (status: number): string => Object.keys(responses[String(status)].content)[0]

function assertContract({ status, body }: Reply) {
  const ref = responses[String(status)].content[media(status)].schema.$ref
  expect(ajv.validate({ $ref: `IF-2${ref}` }, body), `IF-2 ${status} ${JSON.stringify(body)}`).toBe(true)
}

const cleared = 'Form cleared for the next visitor'
const jane = ['Jane', 'Doe', 'jane.doe@example.com', '4155550132'] as const
const ids = ['firstName', 'lastName', 'email', 'phone'] as const
const widths = [320, 768, 1280] as const

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
  await expect.poll(() => focusedId(page)).toBe('firstName')
  return { page, context, requests }
}

async function fill(page: Page, values: readonly string[] = jane) {
  for (const [index, id] of ids.entries()) await page.fill(`#${id}`, values[index])
}

/** Given I have just registered as "Jane": the confirmation is shown and its heading has focus. */
async function registerJane(page: Page) {
  await fill(page)
  await page.locator('button[type="submit"]').click()
  await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
  await expect.poll(() => focusedId(page)).toBe('confirmation-title')
}

const anotherVisitor = (page: Page) => page.getByRole('button', { name: 'Register another visitor' })
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '')

/** Then the cleared form is back, First name has focus and the screen reader hears it. */
async function expectClearedForm(page: Page) {
  await page.locator('#firstName').waitFor()
  await expect.poll(() => focusedId(page)).toBe('firstName')
  await expect.poll(() => page.getByRole('status').innerText()).toBe(cleared)
  expect(await page.getByRole('status').count()).toBe(1)
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
      await registerJane(page)
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Thank you, Jane!')
      await page.keyboard.press('Tab')
      await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Register another visitor')
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')
      expect(await page.getByRole('button').count()).toBe(1)
      expect(await page.locator('button, [role="button"], input[type="button"], input[type="submit"]').count()).toBe(1)
      // The one button leads forward from the keyboard as well: Enter clears the kiosk.
      await page.keyboard.press('Enter')
      await expectClearedForm(page)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The form comes back without a page reload @story:ST-5 @criterion:AC-2', () => {
    it('Given the confirmation is shown and the Network panel is recording, When I activate "Register another visitor", Then the registration form is shown And no new page request was made', async () => {
      const { page, context, requests } = await open()
      await page.evaluate(() => Object.assign(window, { sameDocument: true }))
      await registerJane(page)
      const before = requests.length
      await anotherVisitor(page).click()
      await page.getByRole('heading', { name: 'Visitor registration' }).waitFor()
      await expectClearedForm(page)
      expect(await page.locator('form').count()).toBe(1)
      expect(requests.slice(before).filter((request) => !request.endsWith('/favicon.ico'))).toEqual([])
      expect(requests.filter((request) => request.startsWith('document '))).toEqual([`document GET ${origin}/`])
      expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true)
      expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane\'s confirmation is shown, When I activate "Register another visitor", Then all four inputs are blank And no field error, summary box, alert or "Thank you" heading is shown And the cursor is in "First name" And a screen reader announces "Form cleared for the next visitor"', async () => {
      const { page, context } = await open()
      await registerJane(page)
      await anotherVisitor(page).click()
      await expectClearedForm(page)
      for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
      expect(await page.locator('input').count()).toBe(4)
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
      expect(await page.locator('[id$="-error"]').count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(await page.getByText('Thank you').count()).toBe(0)
      expect(await page.getByRole('heading').allInnerTexts()).toEqual(['Visitor registration'])
      const status = page.getByRole('status')
      expect(await status.getAttribute('class')).toBe('sr-only')
      expect(await status.evaluate((element) => element.closest('[aria-hidden="true"]'))).toBeNull()
      // The next visitor can start typing straight away, and the announcement stays put.
      await page.keyboard.type('Sam')
      expect(await page.locator('#firstName').inputValue()).toBe('Sam')
      expect(await status.innerText()).toBe(cleared)
      await context.close()
    }, 60_000)

    it('the announcement goes quiet once the next visitor submits, and the next confirmation names them', async () => {
      const sam: Reply = { status: 201, body: { firstName: 'Sam', createdAt: '2026-10-20T14:05:00Z' } }
      const { page, context } = await open([created, sam])
      await registerJane(page)
      await anotherVisitor(page).click()
      await expectClearedForm(page)
      await fill(page, ['Sam', 'Roe', 'sam.roe@example.com', '4155550199'])
      await page.locator('button[type="submit"]').click()
      await page.getByRole('heading', { name: 'Thank you, Sam!' }).waitFor()
      expect(await page.getByText(cleared).count()).toBe(0)
      expect(await page.getByRole('status').count()).toBe(0)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane first pressed Submit with an empty phone and saw its error, And she then registered successfully, When she activates "Register another visitor", Then no field error and no summary box is shown', async () => {
      const { page, context } = await open([phoneMissing, created])
      await fill(page, [...jane.slice(0, 3), ''])
      await page.locator('button[type="submit"]').click()
      await page.locator('#phone-error').waitFor()
      expect(await page.locator('#phone-error').innerText()).toBe(fieldMessages.phone.required)
      await page.fill('#phone', jane[3])
      await page.locator('button[type="submit"]').click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await anotherVisitor(page).click()
      await expectClearedForm(page)
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
      expect(await page.locator('#phone-error').count()).toBe(0)
      expect(await page.getByText(fieldMessages.phone.required).count()).toBe(0)
      expect(await page.locator('#phone').getAttribute('aria-describedby')).toBe('phone-hint')
      expect(await page.getByRole('alert').count()).toBe(0)
      await context.close()
    }, 60_000)
  })

  describe("Scenario: The previous visitor's details leave no trace on the kiosk @story:ST-5 @criterion:AC-4", () => {
    it('Given Jane has registered and pressed "Register another visitor", When the next visitor checks the URL, the tab title and the Back button, And browser storage and cookies are inspected in devtools, Then none of them contains "Jane", "jane.doe@example.com" or "4155550132"', async () => {
      const { page, context } = await open()
      const historyLength = await page.evaluate(() => window.history.length)
      await registerJane(page)
      await anotherVisitor(page).click()
      await expectClearedForm(page)
      const kiosk = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        history: window.history.length,
        state: JSON.stringify(window.history.state),
        local: JSON.stringify({ ...localStorage }),
        session: JSON.stringify({ ...sessionStorage }),
        cookie: document.cookie,
        values: [...document.querySelectorAll('input')].map((input) => input.value).join(''),
        page: document.documentElement.outerHTML,
      }))
      expect(kiosk).toMatchObject({
        url: `${origin}/`,
        title: 'Visitor registration',
        history: historyLength,
        state: 'null',
        local: '{}',
        session: '{}',
        cookie: '',
        values: '',
      })
      const cookies = JSON.stringify(await context.cookies())
      for (const trace of ['Jane', 'jane.doe@example.com', '4155550132']) {
        for (const [where, value] of Object.entries({ ...kiosk, cookies })) expect(value, where).not.toContain(trace)
      }
      // The Back button leads off the screen, and coming forward again shows a blank form.
      await page.goBack()
      expect(page.url()).not.toContain(origin)
      await page.goForward()
      await page.locator('#firstName').waitFor()
      for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
      const text = await page.locator('body').innerText()
      for (const trace of jane) expect(text).not.toContain(trace)
      expect(await page.title()).toBe('Visitor registration')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The reset form is accessible @story:ST-5 @criterion:AC-5', () => {
    const runs = (['no-preference', 'reduce'] as const).flatMap((reducedMotion) => widths.map((width) => ({ width, reducedMotion })))

    it.each(runs)(
      'Given the form has just been reset at $width px ($reducedMotion motion), When an axe scan runs, Then it reports zero violations',
      async ({ width, reducedMotion }) => {
        const { page, context } = await open([created], { width, reducedMotion })
        await registerJane(page)
        await anotherVisitor(page).click()
        await expectClearedForm(page)
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
