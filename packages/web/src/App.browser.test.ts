import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import Ajv2020 from 'ajv/dist/2020.js'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ST-2 in a real browser: the screen served by Vite, the IF-2 route answered by
// page.route() with bodies validated against the contract first. Skips cleanly where no
// Chromium is installed (the scaffold's CI ships none); the static and unit tests still run.
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

let server: ViteDevServer
let origin: string
let browser: Browser

interface Screen {
  readonly page: Page
  readonly context: BrowserContext
  /** Every request the page made, as "METHOD url". */
  readonly requests: string[]
  /** The JSON bodies posted to /api/registrations, in order. */
  readonly posts: unknown[]
  /** Lets a held reply go. */
  readonly release: () => void
}

/** Opens the screen with /api/registrations answering `reply` (or failing), optionally held until release(). */
async function open(
  reply: Reply | 'network-failure',
  { hold = false, width = 1280, reducedMotion = 'no-preference' as 'reduce' | 'no-preference' } = {},
): Promise<Screen> {
  if (reply !== 'network-failure') assertContract(reply)
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion })
  const page = await context.newPage()
  const requests: string[] = []
  const posts: unknown[] = []
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`))
  let release = () => undefined as void
  const held = hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
  await page.route('**/api/registrations', async (route) => {
    posts.push(route.request().postDataJSON())
    await held
    if (reply === 'network-failure') return route.abort('failed')
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
  return { page, context, requests, posts, release: () => release() }
}

async function fill(page: Page, values: readonly string[] = jane) {
  for (const [index, id] of ids.entries()) await page.fill(`#${id}`, values[index])
}

const submitButton = (page: Page) => page.locator('button[type="submit"]')
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '')
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '')

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  return results.violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.help}`)
}

describe.skipIf(!launches)('Feature: Submit my details and see a confirmation once my visit is saved', () => {
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

  describe('Scenario: A valid registration is confirmed by name @story:ST-2 @criterion:AC-1', () => {
    it('Given the registration screen is open, When I enter Jane / Doe / jane.doe@example.com / 4155550132 and press Submit, Then the same screen thanks me and focus is on the heading', async () => {
      const { page, context } = await open(created)
      await page.evaluate(() => Object.assign(window, { sameDocument: true }))
      await fill(page)
      await submitButton(page).click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await expect.poll(() => page.locator('main').innerText()).toContain('Your visit has been registered.')
      expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true)
      expect(page.url()).toBe(`${origin}/`)
      await expect.poll(() => focusedText(page)).toBe('Thank you, Jane!')
      expect(await focusedId(page)).toBe('confirmation-title')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: Exactly one row is stored per submission @story:ST-2 @criterion:AC-2', () => {
    it('When I submit valid details once, Then exactly one POST carrying them reaches /api/registrations', async () => {
      const { page, context, posts } = await open(created)
      await fill(page)
      await submitButton(page).click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      expect(posts).toEqual([{ firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }])
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The stored row is trimmed, normalised and timestamped in UTC @story:ST-2 @criterion:AC-3', () => {
    it('When I submit " Jane " / Doe / jane.doe@example.com / (415) 555-0132, Then the API receives them exactly as typed, to normalise once, and I am thanked by the stored name', async () => {
      const { page, context, posts } = await open(created)
      await fill(page, [' Jane ', 'Doe', 'jane.doe@example.com', '(415) 555-0132'])
      await submitButton(page).click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      expect(posts).toEqual([{ firstName: ' Jane ', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' }])
      expect(await page.locator('h1').textContent()).toBe('Thank you, Jane!')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The form waits while my visit is being saved @story:ST-2 @criterion:AC-4', () => {
    it('Given the API is slow to answer and I have entered valid details, When I press Submit, Then the inputs are read-only with my values and Submit reads "Submitting…" with a spinner', async () => {
      const { page, context, release } = await open(created, { hold: true })
      await fill(page)
      await submitButton(page).focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => submitButton(page).innerText()).toBe('Submitting…')
      expect(await submitButton(page).locator('.animate-spin').count()).toBe(1)
      // Screen readers hear the same words from a polite status region.
      expect(await page.getByRole('status').innerText()).toBe('Submitting…')
      expect(await page.locator('form').getAttribute('aria-busy')).toBeNull()
      for (const [index, id] of ids.entries()) {
        const input = page.locator(`#${id}`)
        expect(await input.inputValue()).toBe(jane[index])
        expect(await input.evaluate((element: HTMLInputElement) => element.readOnly)).toBe(true)
      }
      // Typing into a read-only input changes nothing.
      await page.locator('#lastName').press('X')
      expect(await page.locator('#lastName').inputValue()).toBe('Doe')
      // Submit keeps focus while the save runs: it is aria-disabled, not natively disabled.
      await page.locator('button[type="submit"]').focus()
      expect(await page.evaluate(() => document.activeElement?.getAttribute('type'))).toBe('submit')
      expect(await submitButton(page).evaluate((element: HTMLButtonElement) => element.disabled)).toBe(false)
      expect(await submitButton(page).getAttribute('aria-disabled')).toBe('true')
      expect(await page.title()).toBe('Visitor registration')
      release()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await context.close()
    }, 60_000)

    it('Submit keeps focus from the press until the answer arrives', async () => {
      const { page, context, release } = await open(created, { hold: true })
      await fill(page)
      await submitButton(page).click()
      await expect.poll(() => submitButton(page).innerText()).toBe('Submitting…')
      expect(await focusedText(page)).toBe('Submitting…')
      release()
      await expect.poll(() => focusedText(page)).toBe('Thank you, Jane!')
      await context.close()
    }, 60_000)
  })

  describe('Scenario: A double tap does not register me twice @story:ST-2 @criterion:AC-4', () => {
    it('Given I have entered valid details, When I tap Submit twice in quick succession, Then only one request is sent', async () => {
      const { page, context, posts, release } = await open(created, { hold: true })
      await fill(page)
      // A real double tap: the second taps land on a button that only says it is busy.
      await submitButton(page).dblclick()
      await submitButton(page).click({ force: true })
      await page.keyboard.press('Enter')
      release()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      expect(posts).toHaveLength(1)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The API confirms the save before the screen does @story:ST-2 @criterion:AC-5', () => {
    it('When I submit valid details, Then the POST answers 201 with firstName and createdAt and no id, and the confirmation appears only after it', async () => {
      const { page, context, release } = await open(created, { hold: true })
      await fill(page)
      const response = page.waitForResponse((answer) => answer.url().endsWith('/api/registrations'))
      await submitButton(page).click()
      await expect.poll(() => submitButton(page).innerText()).toBe('Submitting…')
      expect(await page.getByText('Thank you, Jane!').count()).toBe(0)
      release()
      const answer = await response
      expect(answer.status()).toBe(201)
      const body = await answer.json()
      expect(Object.keys(body).sort()).toEqual(['createdAt', 'firstName'])
      expect(body.firstName).toBe('Jane')
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await context.close()
    }, 60_000)

    it.each([
      { status: 403, body: { error: 'forbidden' } },
      { status: 413, body: { error: 'too_large' } },
      { status: 415, body: { error: 'unsupported_media_type' } },
      { status: 429, body: { error: 'rate_limited' } },
      { status: 500, body: { error: 'internal' } },
      { status: 400, body: { error: 'validation', fields: {} } },
    ])(
      'a $status never confirms: the alert shows, my values stay and Submit keeps focus',
      async (reply) => {
        const { page, context } = await open(reply)
        await fill(page)
        await submitButton(page).click()
        await page.getByRole('alert').waitFor()
        expect(await page.getByRole('alert').innerText()).toBe('Your visit could not be saved. Please try again.')
        expect(await page.getByText('Thank you').count()).toBe(0)
        for (const [index, id] of ids.entries()) expect(await page.locator(`#${id}`).inputValue()).toBe(jane[index])
        await expect.poll(() => focusedText(page)).toBe('Submit')
        expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
        expect(await page.title()).toBe('Visitor registration')
        await context.close()
      },
      60_000,
    )

    it('after a failed save, Submit tries again and the 201 then confirms', async () => {
      const { page, context, posts } = await open({ status: 500, body: { error: 'internal' } })
      await fill(page)
      await submitButton(page).click()
      await page.getByRole('alert').waitFor()
      assertContract(created)
      await page.unroute('**/api/registrations')
      await page.route('**/api/registrations', (route) =>
        route.fulfill({
          status: 201,
          contentType: media(201),
          headers: { 'Cache-Control': 'no-store' },
          body: JSON.stringify(created.body),
        }),
      )
      await submitButton(page).click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      await expect.poll(() => focusedText(page)).toBe('Thank you, Jane!')
      expect(posts).toHaveLength(1)
      expect(await page.getByRole('alert').count()).toBe(0)
      await context.close()
    }, 60_000)

    it('no answer at all never confirms either', async () => {
      const { page, context } = await open('network-failure')
      await fill(page)
      await submitButton(page).click()
      await page.getByRole('alert').waitFor()
      expect(await page.getByText('Thank you').count()).toBe(0)
      await context.close()
    }, 60_000)

    it('a 400 naming a field shows the server message verbatim on it and moves focus there', async () => {
      const message = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
      const { page, context } = await open({ status: 400, body: { error: 'validation', fields: { phone: [message] } } })
      await fill(page)
      await submitButton(page).click()
      await expect.poll(() => focusedId(page)).toBe('phone')
      expect(await page.locator('#phone-error').innerText()).toBe(message)
      expect(await page.locator('#phone').getAttribute('aria-invalid')).toBe('true')
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(1)
      expect(await page.getByRole('alert').count()).toBe(0)
      await context.close()
    }, 60_000)
  })

  describe('Scenario: The confirmation on screen is the only acknowledgement @story:ST-2 @criterion:AC-6', () => {
    it('When I submit Jane / Doe / jane.doe@example.com / 4155550132, Then only the thanks, the sentence and the button show, the title reads "Registration complete" and one request goes to the page’s own origin', async () => {
      const { page, context, requests } = await open(created)
      const before = requests.length
      await fill(page)
      await submitButton(page).click()
      await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
      const card = (await page.locator('#registration-card').innerText()).split('\n').filter(Boolean)
      expect(card).toEqual(['Thank you, Jane!', 'Your visit has been registered.', 'Register another visitor'])
      const words = card.join(' ').toLowerCase()
      expect(words).not.toContain('email')
      expect(words).not.toContain('text message')
      expect(await page.getByRole('button').count()).toBe(1)
      expect(await page.getByRole('button').innerText()).toBe('Register another visitor')
      await expect.poll(() => page.title()).toBe('Registration complete')
      expect(await page.title()).not.toContain('Jane')
      // The browser may ask for a favicon on its own; the screen itself makes one request.
      expect(requests.slice(before).filter((request) => !request.endsWith('/favicon.ico'))).toEqual([`POST ${origin}/api/registrations`])
      for (const request of requests) expect(request.split(' ')[1].startsWith(`${origin}/`)).toBe(true)
      await context.close()
    }, 60_000)

    it('"Register another visitor" brings back a blank form with First name focused, and leaves no trace of me', async () => {
      const { page, context } = await open(created)
      const historyLength = await page.evaluate(() => window.history.length)
      await fill(page)
      await submitButton(page).click()
      await page.getByRole('button', { name: 'Register another visitor' }).click()
      await page.locator('#firstName').waitFor()
      await expect.poll(() => focusedId(page)).toBe('firstName')
      for (const id of ids) expect(await page.locator(`#${id}`).inputValue()).toBe('')
      expect(await page.locator('[aria-invalid="true"]').count()).toBe(0)
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(await submitButton(page).innerText()).toBe('Submit')
      await expect.poll(() => page.title()).toBe('Visitor registration')
      expect(page.url()).toBe(`${origin}/`)
      const trace = await page.evaluate(() => ({
        history: window.history.length,
        state: JSON.stringify(window.history.state),
        local: localStorage.length,
        session: sessionStorage.length,
        cookie: document.cookie,
        text: document.body.innerText,
      }))
      expect(trace).toEqual({ history: historyLength, state: 'null', local: 0, session: 0, cookie: '', text: expect.any(String) })
      for (const value of jane) expect(trace.text).not.toContain(value)
      expect((await context.cookies()).length).toBe(0)
      await context.close()
    }, 60_000)

    it('the confirmation card never scrolls sideways and stays within 480px at every width', async () => {
      for (const width of widths) {
        const { page, context } = await open(created, { width })
        await fill(page)
        await submitButton(page).click()
        await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
        const layout = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          card: document.getElementById('registration-card')?.getBoundingClientRect().width ?? 0,
        }))
        expect(layout.scroll, `width ${width}`).toBeLessThanOrEqual(layout.client)
        expect(layout.card, `width ${width}`).toBeLessThanOrEqual(480)
        await context.close()
      }
    }, 120_000)
  })

  describe('Scenario: The saving and confirmation states are accessible @story:ST-2 @criterion:AC-7', () => {
    const runs = (['no-preference', 'reduce'] as const).flatMap((reducedMotion) => widths.map((width) => ({ width, reducedMotion })))

    it.each(runs)(
      'Given an axe scan is ready, When the screen is submitting and then confirmed at $width px ($reducedMotion motion), Then each scan reports zero violations',
      async ({ width, reducedMotion }) => {
        const { page, context, release } = await open(created, { hold: true, width, reducedMotion })
        await fill(page)
        await submitButton(page).click()
        await expect.poll(() => submitButton(page).innerText()).toBe('Submitting…')
        expect(await axeViolations(page)).toEqual([])
        release()
        await page.getByRole('heading', { name: 'Thank you, Jane!' }).waitFor()
        await expect.poll(() => focusedText(page)).toBe('Thank you, Jane!')
        expect(await axeViolations(page)).toEqual([])
        await context.close()
      },
      60_000,
    )

    it('the spinner stops spinning for a visitor who asks for reduced motion', async () => {
      const { page, context, release } = await open(created, { hold: true, reducedMotion: 'reduce' })
      await fill(page)
      await submitButton(page).click()
      await expect.poll(() => submitButton(page).innerText()).toBe('Submitting…')
      const animation = await submitButton(page)
        .locator('.animate-spin')
        .evaluate((element) => getComputedStyle(element).animationName)
      expect(animation).toBe('none')
      release()
      await context.close()
    }, 60_000)

    it.each(runs)(
      'the save-failed alert and a flagged field report zero violations too, at $width px ($reducedMotion motion)',
      async ({ width, reducedMotion }) => {
        const message = 'Enter a 10-digit US number without +1, e.g. (415) 555-0132.'
        const failed = await open({ status: 500, body: { error: 'internal' } }, { width, reducedMotion })
        await fill(failed.page)
        await submitButton(failed.page).click()
        await failed.page.getByRole('alert').waitFor()
        expect(await failed.page.getByRole('alert').innerText()).toBe('Your visit could not be saved. Please try again.')
        expect(await axeViolations(failed.page)).toEqual([])
        await failed.context.close()

        const flagged = await open({ status: 400, body: { error: 'validation', fields: { phone: [message] } } }, { width, reducedMotion })
        await fill(flagged.page)
        await submitButton(flagged.page).click()
        await flagged.page.locator('#phone-error').waitFor()
        expect(await flagged.page.locator('#phone-error').innerText()).toBe(message)
        expect(await axeViolations(flagged.page)).toEqual([])
        await flagged.context.close()
      },
      60_000,
    )
  })
})
