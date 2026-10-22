import AxeBuilder from '@axe-core/playwright'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright'
import { build, type Rollup } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copy } from './copy.js'

// ST-5 in a real browser: the built screen (vite build, CSP included) is served from one
// origin, POST /api/registrations answers with the IF-2 contract's own examples, and every
// scenario is driven by keyboard and pointer exactly as the Gherkin reads. Skips cleanly
// where no Chromium is installed; the node suites cover the same decisions.

const origin = 'http://kiosk.test'
const webRoot = fileURLToPath(new URL('..', import.meta.url))
const traces = ['Jane', 'jane.doe@example.com', '4155550132']
const phoneError = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
const created = { status: 201, contentType: 'application/json', body: { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' } }
const internal = { status: 500, contentType: 'application/problem+json', body: { error: 'internal' } }
const phoneProblem = {
  status: 400,
  contentType: 'application/problem+json',
  body: { error: 'validation', fields: { phone: [phoneError] } },
}

type Reply = typeof created | typeof phoneProblem | typeof internal

/** Chromium as Playwright installed it, or any headless Chromium under PLAYWRIGHT_BROWSERS_PATH. */
function chromiumExecutable(): string | undefined {
  const bundled = chromium.executablePath()
  if (existsSync(bundled)) return bundled
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const candidates = [
    'chrome-linux/headless_shell',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
  ]
  for (const dir of readdirSync(root)
    .filter((name) => name.startsWith('chromium'))
    .sort()
    .reverse()) {
    for (const candidate of candidates) {
      const path = join(root, dir, candidate)
      if (existsSync(path)) return path
    }
  }
  return undefined
}

const executablePath = chromiumExecutable()

describe.skipIf(!executablePath)('Feature: Clear the kiosk for the next visitor (browser)', () => {
  const files = new Map<string, { body: string | Uint8Array; type: string }>()
  let browser: Browser

  beforeAll(async () => {
    const result = (await build({
      root: webRoot,
      configFile: join(webRoot, 'vite.config.ts'),
      logLevel: 'silent',
      build: { write: false },
    })) as Rollup.RollupOutput
    for (const file of result.output) {
      const body = file.type === 'chunk' ? file.code : file.source
      const type = file.fileName.endsWith('.js') ? 'text/javascript' : file.fileName.endsWith('.css') ? 'text/css' : 'text/html'
      files.set(`/${file.fileName}`, { body, type })
    }
    browser = await chromium.launch({ executablePath })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  interface Kiosk {
    context: BrowserContext
    page: Page
    posts: string[]
    documents: Request[]
  }

  /** A fresh kiosk tab on the screen, answering each POST with the next reply in line. */
  async function openKiosk(
    replies: Reply[],
    options: { width?: number; reducedMotion?: 'reduce'; delay?: Promise<void> } = {},
  ): Promise<Kiosk> {
    const context = await browser.newContext({
      viewport: { width: options.width ?? 1280, height: 900 },
      reducedMotion: options.reducedMotion,
    })
    const page = await context.newPage()
    const posts: string[] = []
    const documents: Request[] = []
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(request)
    })
    await page.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/registrations' && route.request().method() === 'POST') {
        posts.push(route.request().postData() ?? '')
        await options.delay
        const reply = replies.shift() ?? created
        await route.fulfill({
          status: reply.status,
          contentType: reply.contentType,
          headers: { 'Cache-Control': 'no-store' },
          body: JSON.stringify(reply.body),
        })
        return
      }
      const file = files.get(url.pathname === '/' ? '/index.html' : url.pathname)
      if (!file) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ status: 200, contentType: file.type, body: Buffer.from(file.body) })
    })
    await page.goto(`${origin}/`)
    return { context, page, posts, documents }
  }

  const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)

  async function fillJane(page: Page, phone = '4155550132') {
    await page.getByLabel('First name').fill('Jane')
    await page.getByLabel('Last name').fill('Doe')
    await page.getByLabel('Email').fill('jane.doe@example.com')
    await page.getByLabel('Phone number').fill(phone)
  }

  /** Given I have just registered as "Jane". */
  async function registerJane(kiosk: Kiosk) {
    await fillJane(kiosk.page)
    await kiosk.page.getByRole('button', { name: 'Submit' }).click()
    await expect.poll(() => focusedId(kiosk.page), { timeout: 10_000 }).toBe('confirmation-title')
  }

  async function axeViolations(page: Page) {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    return results.violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.help}`)
  }

  describe('Scenario: The confirmation offers one way forward @story:ST-5 @criterion:AC-1', () => {
    it('Given I have just registered as "Jane", When I press Tab once from the heading "Thank you, Jane!", Then focus is on the button "Register another visitor", And it is the only button on the screen', async () => {
      let release: () => void = () => undefined
      const delay = new Promise<void>((resolve) => (release = resolve))
      const kiosk = await openKiosk([created], { delay })
      const { page } = kiosk
      await fillJane(page)
      await page.getByRole('button', { name: 'Submit' }).focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await expect.poll(() => page.getByRole('button', { name: 'Submit' }).getAttribute('aria-disabled'), { timeout: 10_000 }).toBe('true')
      expect(await focusedId(page)).toBe('submit-button')
      release()
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('confirmation-title')
      expect(kiosk.posts).toHaveLength(1)
      expect(await page.getByRole('heading', { level: 1 }).textContent()).toBe('Thank you, Jane!')
      await page.keyboard.press('Tab')
      expect(
        await page.getByRole('button', { name: 'Register another visitor' }).evaluate((element) => element === document.activeElement),
      ).toBe(true)
      expect(await page.getByRole('button').count()).toBe(1)
      expect(await page.getByRole('button').textContent()).toBe('Register another visitor')
      await kiosk.context.close()
    }, 30_000)
  })

  describe('Scenario: The form comes back without a page reload @story:ST-5 @criterion:AC-2', () => {
    it('Given the confirmation is shown and the Network panel is recording, When I activate "Register another visitor", Then the registration form is shown, And no new page request was made', async () => {
      const kiosk = await openKiosk([created])
      const { page } = kiosk
      await registerJane(kiosk)
      await page.evaluate(() => Object.assign(window, { sameDocument: true }))
      const documentsBefore = kiosk.documents.length
      expect(documentsBefore).toBe(1)
      await page.getByRole('button', { name: 'Register another visitor' }).click()
      await expect.poll(() => page.getByRole('heading', { level: 1 }).textContent(), { timeout: 10_000 }).toBe('Visitor registration')
      expect(await page.getByRole('form', { name: 'Visitor registration' }).count()).toBe(1)
      expect(kiosk.documents).toHaveLength(documentsBefore)
      expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true)
      expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1)
      await kiosk.context.close()
    }, 30_000)
  })

  describe('Scenario: The next visitor gets a clean form @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane’s confirmation is shown, When I activate "Register another visitor" by keyboard, Then all four inputs are blank, And no field error, summary box, alert or "Thank you" heading is shown, And the cursor is in "First name", And a screen reader announces "Form cleared for the next visitor"', async () => {
      const kiosk = await openKiosk([created])
      const { page } = kiosk
      await registerJane(kiosk)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('firstName')
      for (const label of ['First name', 'Last name', 'Email', 'Phone number']) expect(await page.getByLabel(label).inputValue()).toBe('')
      expect(await page.locator('[aria-invalid]').count()).toBe(0)
      expect(await page.locator('#error-summary').count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(await page.getByRole('heading', { name: 'Thank you', exact: false }).count()).toBe(0)
      expect(await page.getByRole('status').textContent()).toBe('Form cleared for the next visitor')
      expect(copy.formCleared).toBe('Form cleared for the next visitor')
      await kiosk.context.close()
    }, 30_000)
  })

  describe('Scenario: Errors from an earlier attempt are gone after the reset @story:ST-5 @criterion:AC-3', () => {
    it('Given Jane first pressed Submit with an empty phone and saw its error, And she then registered successfully, When she activates "Register another visitor", Then no field error and no summary box is shown', async () => {
      const kiosk = await openKiosk([phoneProblem, created])
      const { page } = kiosk
      await fillJane(page, '')
      await page.getByRole('button', { name: 'Submit' }).click()
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('error-summary')
      expect(await page.locator('#phone-error').textContent()).toBe(phoneError)
      expect(await page.getByLabel('Phone number').getAttribute('aria-invalid')).toBe('true')
      expect(await axeViolations(page)).toEqual([])
      await page.getByLabel('Phone number').fill('4155550132')
      await page.getByRole('button', { name: 'Submit' }).click()
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('confirmation-title')
      await page.getByRole('button', { name: 'Register another visitor' }).click()
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('firstName')
      expect(await page.locator('#phone-error').count()).toBe(0)
      expect(await page.locator('#error-summary').count()).toBe(0)
      expect(await page.locator('[aria-invalid]').count()).toBe(0)
      expect(await page.getByText(phoneError).count()).toBe(0)
      await kiosk.context.close()
    }, 30_000)
  })

  describe('Scenario: The previous visitor’s details leave no trace on the kiosk @story:ST-5 @criterion:AC-4', () => {
    it('Given Jane has registered and pressed "Register another visitor", When the next visitor checks the URL, the tab title and the Back button, And browser storage and cookies are inspected in devtools, Then none of them contains "Jane", "jane.doe@example.com" or "4155550132"', async () => {
      const kiosk = await openKiosk([created])
      const { page, context } = kiosk
      const historyAtOpen = await page.evaluate(() => history.length)
      await registerJane(kiosk)
      expect(await page.title()).toBe('Registration complete')
      await page.getByRole('button', { name: 'Register another visitor' }).click()
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('firstName')

      const seen = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        historyLength: history.length,
        historyState: JSON.stringify(history.state),
        local: JSON.stringify({ ...localStorage }),
        localLength: localStorage.length,
        session: JSON.stringify({ ...sessionStorage }),
        sessionLength: sessionStorage.length,
        cookie: document.cookie,
        dom: document.documentElement.outerHTML,
      }))
      expect(seen.url).toBe(`${origin}/`)
      expect(seen.title).toBe('Visitor registration')
      expect(await page.locator('form').evaluate((form) => (form as HTMLFormElement).noValidate)).toBe(true)
      expect(seen.historyLength).toBe(historyAtOpen)
      expect(seen.historyState).toBe('null')
      expect(seen.localLength).toBe(0)
      expect(seen.sessionLength).toBe(0)
      expect(seen.cookie).toBe('')
      expect(await context.cookies()).toEqual([])
      const storage = await context.storageState()
      for (const value of [...Object.values(seen), JSON.stringify(storage)]) {
        for (const trace of traces) expect(String(value)).not.toContain(trace)
      }

      // Back leaves the screen for whatever the tab held before it (here the blank start page).
      await page.goBack()
      expect(kiosk.documents).toHaveLength(1)
      const back = page.url() + (await page.title()) + (await page.content())
      for (const trace of traces) expect(back).not.toContain(trace)
      await kiosk.context.close()
    }, 30_000)
  })

  describe('Scenario: The reset form is accessible @story:ST-5 @criterion:AC-5', () => {
    for (const [width, reducedMotion] of [
      [1280, undefined],
      [768, undefined],
      [360, undefined],
      [320, undefined],
      [1280, 'reduce'],
      [320, 'reduce'],
    ] as const) {
      it(`Given the form has just been reset at ${width}px${reducedMotion ? ' with reduced motion' : ''}, When an axe scan runs, Then it reports zero violations`, async () => {
        const kiosk = await openKiosk([created], { width, reducedMotion })
        const { page } = kiosk
        await registerJane(kiosk)
        expect(await axeViolations(page)).toEqual([])
        await page.getByRole('button', { name: 'Register another visitor' }).click()
        await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('firstName')
        expect(await axeViolations(page)).toEqual([])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        expect(await page.evaluate(() => document.getElementById('registration-card')!.getBoundingClientRect().width)).toBeLessThanOrEqual(
          480,
        )
        await kiosk.context.close()
      }, 30_000)
    }
  })

  describe('Scenario: A failed save keeps the visitor on the form, never on a confirmation (the path a reset must not hide)', () => {
    it('Given Jane pressed Submit and the store answered 500, Then focus stays on Submit, one alert shows, her values remain, axe is clean, And a retry that saves still resets cleanly', async () => {
      const kiosk = await openKiosk([internal, created])
      const { page } = kiosk
      await fillJane(page)
      await page.getByRole('button', { name: 'Submit' }).click()
      await expect.poll(() => page.getByRole('alert').count(), { timeout: 10_000 }).toBe(1)
      expect(await focusedId(page)).toBe('submit-button')
      expect(await page.getByRole('alert').textContent()).toBe(copy.saveFailed)
      expect(await page.getByLabel('Email').inputValue()).toBe('jane.doe@example.com')
      expect(await page.getByRole('heading', { name: 'Thank you', exact: false }).count()).toBe(0)
      expect(await axeViolations(page)).toEqual([])
      await page.getByRole('button', { name: 'Submit' }).click()
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('confirmation-title')
      await page.getByRole('button', { name: 'Register another visitor' }).click()
      await expect.poll(() => focusedId(page), { timeout: 10_000 }).toBe('firstName')
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(kiosk.posts).toHaveLength(2)
      await kiosk.context.close()
    }, 30_000)
  })
})
