import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium, type Browser, type BrowserContextOptions, type Page } from 'playwright'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ST-1 against the production bundle: vite builds packages/web, a bare static server hands
// it out, and Playwright chromium drives it. The browser half skips when no chromium exists.
const webRoot = fileURLToPath(new URL('..', import.meta.url))
const widths = [320, 360, 768, 1920]
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
}

/** Playwright's own chromium, else any chromium build under PLAYWRIGHT_BROWSERS_PATH. */
function findChromium(): string | undefined {
  const own = chromium.executablePath()
  if (existsSync(own)) return own
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  for (const dir of readdirSync(root).sort().reverse()) {
    for (const exe of ['chrome-linux/headless_shell', 'chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      if (existsSync(join(root, dir, exe))) return join(root, dir, exe)
    }
  }
  return undefined
}

const executablePath = findChromium()
let outDir = ''
let html = ''
let server: Server
let origin = ''

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'scr-1-'))
  await build({
    root: webRoot,
    configFile: join(webRoot, 'vite.config.ts'),
    mode: 'production',
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  })
  html = await readFile(join(outDir, 'index.html'), 'utf8')
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const file = normalize(join(outDir, path === '/' ? 'index.html' : path))
    if (!file.startsWith(outDir)) {
      res.writeHead(404).end()
      return
    }
    readFile(file).then(
      (body) => res.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' }).end(body),
      () => res.writeHead(404).end(),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 120_000)

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve))
  if (outDir) await rm(outDir, { recursive: true, force: true })
})

describe('Feature: Open the registration screen at the lobby kiosk from one container — built page @story:ST-1', () => {
  it('the page is titled "Visitor registration" @criterion:AC-2', () => {
    expect(html).toContain('<title>Visitor registration</title>')
    expect(html).toContain('<html lang="en">')
  })

  it('the page carries a Content-Security-Policy limiting scripts to self @criterion:AC-7', () => {
    const start = html.indexOf('<meta http-equiv="Content-Security-Policy"')
    expect(start).toBeGreaterThan(-1)
    const meta = html.slice(start, html.indexOf('>', start))
    for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "object-src 'none'"]) {
      expect(meta).toContain(directive)
    }
    expect(meta).not.toContain('unsafe-inline')
    expect(meta).not.toContain('unsafe-eval')
  })

  it('every script and stylesheet is a same-origin file, none inline @criterion:AC-7', () => {
    const scripts = html.split('<script').slice(1)
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) expect(script.slice(0, script.indexOf('>'))).toContain('src="/assets/')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
  })
})

describe.skipIf(!executablePath)('Feature: Open the registration screen at the lobby kiosk from one container @story:ST-1', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
  })

  async function open(options: BrowserContextOptions = {}): Promise<{ page: Page; requests: string[]; problems: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options })
    const page = await context.newPage()
    const requests: string[] = []
    const problems: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text())
    })
    page.on('pageerror', (error) => problems.push(error.message))
    await page.goto(`${origin}/`)
    await page.getByRole('heading', { name: 'Visitor registration' }).waitFor()
    return { page, requests, problems }
  }

  const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName)

  async function axeViolations(page: Page): Promise<string[]> {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    return results.violations.map((violation) => `${violation.impact}: ${violation.id}`)
  }

  it('Scenario: The form shows exactly the four visitor fields @criterion:AC-2', async () => {
    // Given the registration screen is open
    const { page } = await open()
    // When I look at the form
    const form = page.getByRole('form', { name: 'Visitor registration' })
    // Then I see the inputs "First name", "Last name", "Email" and "Phone number", each marked required
    for (const label of ['First name', 'Last name', 'Email', 'Phone number']) {
      const input = form.getByLabel(label, { exact: true })
      expect(await input.isVisible()).toBe(true)
      expect(await input.evaluate((el) => (el as HTMLInputElement).required)).toBe(true)
    }
    expect(await page.locator('input, select, textarea').count()).toBe(4)
    expect(await page.getByText('Please register. All fields are required.', { exact: true }).isVisible()).toBe(true)
    // And I see the hint "10-digit US number, e.g. (415) 555-0132" under the phone input
    const hint = page.getByText('10-digit US number, e.g. (415) 555-0132', { exact: true })
    expect(await hint.isVisible()).toBe(true)
    const phone = form.getByLabel('Phone number', { exact: true })
    expect(await phone.getAttribute('aria-describedby')).toBe(await hint.getAttribute('id'))
    expect((await hint.boundingBox())!.y).toBeGreaterThan((await phone.boundingBox())!.y)
    // And I see exactly one button, "Submit"
    expect(await page.getByRole('button').count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Submit', exact: true }).isVisible()).toBe(true)
    await page.context().close()
  })

  it('Scenario: There is nowhere else to go @criterion:AC-3', async () => {
    // Given the registration screen is open
    const { page } = await open()
    // When I look for links or navigation on the page
    const found = await page.locator('a, nav, [role="link"], [role="navigation"], [role="menu"], [role="menubar"]').count()
    // Then I find none
    expect(found).toBe(0)
    await page.context().close()
  })

  it('Scenario: The first visitor sees an empty, calm form @criterion:AC-4', async () => {
    // Given the container has just started
    // When I open the registration screen
    const { page, problems } = await open()
    // Then all four inputs are blank
    expect(await page.locator('input').evaluateAll((inputs) => inputs.map((el) => (el as HTMLInputElement).value))).toEqual([
      '',
      '',
      '',
      '',
    ])
    // And no field error, summary box or alert is shown
    expect(await page.locator('[role="alert"], [role="status"], [aria-live], [aria-invalid="true"]').count()).toBe(0)
    // And the cursor is in "First name"
    expect(await activeId(page)).toBe('firstName')
    expect(problems).toEqual([])
    await page.context().close()
  })

  it.each(widths)('Scenario Outline: The form fits kiosk, tablet and narrow screens — %ipx @criterion:AC-5', async (width) => {
    // Given the browser viewport is <width> pixels wide
    // When I open the registration screen
    const { page } = await open({ viewport: { width, height: 800 } })
    // Then every input and the Submit button are visible without horizontal scrolling
    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth)
    for (const control of await page.locator('input, button').all()) {
      expect(await control.isVisible()).toBe(true)
      const box = (await control.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
    // And the form card is no wider than 480 pixels
    const card = (await page.getByRole('form', { name: 'Visitor registration' }).boundingBox())!
    expect(card.width).toBeLessThanOrEqual(480)
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.width).toBeLessThanOrEqual(width)
    await page.context().close()
  })

  it('Scenario: A keyboard-only visitor can reach every control in order @criterion:AC-6', async () => {
    // Given the registration screen is open with focus in "First name"
    const { page } = await open()
    expect(await activeId(page)).toBe('firstName')
    // When I press Tab four times
    const visited: (string | undefined)[] = []
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab')
      visited.push(await activeId(page))
    }
    // Then focus has moved through "Last name", "Email", "Phone number" and "Submit" in that order
    expect(visited).toEqual(['lastName', 'email', 'phone', 'submit'])
    expect(await page.getByRole('button', { name: 'Submit' }).evaluate((el) => el === document.activeElement)).toBe(true)
    // And an axe scan of the empty screen reports zero violations
    expect(await axeViolations(page)).toEqual([])
    await page.context().close()
  })

  it.each(widths)(
    'Scenario: An axe scan of the empty screen at %ipx, with and without reduced motion, reports zero violations @criterion:AC-6',
    async (width) => {
      for (const reducedMotion of ['no-preference', 'reduce'] as const) {
        const { page } = await open({ viewport: { width, height: 800 }, reducedMotion })
        expect(await axeViolations(page)).toEqual([])
        await page.context().close()
      }
    },
  )

  it('Scenario: The page relies on nothing outside the container @criterion:AC-7', async () => {
    // Given the browser's Network panel is recording
    const context = await browser.newContext()
    await context.addInitScript(() => {
      const record: string[] = []
      ;(window as unknown as { cspViolations: string[] }).cspViolations = record
      document.addEventListener('securitypolicyviolation', (event) => record.push(event.violatedDirective))
    })
    const page = await context.newPage()
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    // When I open the registration screen
    await page.goto(`${origin}/`)
    await page.getByRole('heading', { name: 'Visitor registration' }).waitFor()
    await page.waitForLoadState('networkidle')
    // Then every request goes to the page's own origin
    expect(requests.length).toBeGreaterThan(0)
    for (const url of requests) expect(new URL(url).origin).toBe(origin)
    // And the page has a Content-Security-Policy with "script-src 'self'" that nothing on it breaks
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("script-src 'self'")
    expect(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)).toEqual([])
    await context.close()
  })

  it('Scenario: A visitor’s typing never leaves the page @criterion:AC-4', async () => {
    // Given the registration screen is open
    const { page } = await open()
    const historyLength = await page.evaluate(() => history.length)
    // When a visitor types every field and presses Submit
    await page.keyboard.type('Ada')
    await page.getByLabel('Last name', { exact: true }).fill('Lovelace')
    await page.getByLabel('Email', { exact: true }).fill('ada@example.com')
    await page.getByLabel('Phone number', { exact: true }).fill('4155550132')
    await page.getByRole('button', { name: 'Submit' }).click()
    // Then the inputs keep what was typed, and nothing reaches the URL, history, storage or cookies
    expect(await page.getByLabel('First name', { exact: true }).inputValue()).toBe('Ada')
    expect(page.url()).toBe(`${origin}/`)
    expect(await page.evaluate(() => [history.length, history.state, localStorage.length, sessionStorage.length, document.cookie])).toEqual(
      [historyLength, null, 0, 0, ''],
    )
    expect(await page.context().cookies()).toEqual([])
    await page.context().close()
  })
})
