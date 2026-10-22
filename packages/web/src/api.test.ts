import { readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { postRegistration, registrationsPath } from './api.js'

// IF-2 consumer tests. Every mocked response is first validated against the committed
// contract (src/contract/IF-2.json, the step-7 IF-2 the screen is built against), so the
// client is only ever proven against bodies the API is allowed to send.
type Media = { schema: { $ref: string }; example?: unknown; examples?: Record<string, { value: unknown }> }
type Contract = {
  paths: Record<
    string,
    { post: { requestBody: { content: Record<string, Media> }; responses: Record<string, { content: Record<string, Media> }> } }
  >
  components: Record<string, unknown>
}

const contract = JSON.parse(readFileSync(new URL('./contract/IF-2.json', import.meta.url), 'utf8')) as Contract
const operation = contract.paths['/api/registrations'].post
const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema({ $id: 'if2', components: contract.components })

function conforms(ref: string, value: unknown): string[] {
  const validate = ajv.getSchema(`if2${ref}`)
  if (validate === undefined) return [`unresolved ${ref}`]
  return validate(value) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`)
}

/** A Response for the given status whose body the contract allows, with the contract's media type. */
function contractResponse(status: number, body: unknown): Response {
  const response = operation.responses[String(status)]
  expect(response, `IF-2 documents ${status}`).toBeDefined()
  const [mediaType, media] = Object.entries(response.content)[0]
  expect(conforms(media.schema.$ref, body)).toEqual([])
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': mediaType, 'Cache-Control': 'no-store' } })
}

/** The example the contract gives for a status (or one of its named examples). */
function example(status: number, name?: string): unknown {
  const media = Object.values(operation.responses[String(status)].content)[0]
  return name === undefined ? media.example : media.examples?.[name].value
}

const jane = { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '4155550132' }

function fetchAnswering(response: Response | Error) {
  return vi.fn<typeof fetch>(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)))
}

afterEach(() => vi.unstubAllGlobals())

describe('Feature: Submit my details and see a confirmation once my visit is saved — the IF-2 client', () => {
  describe('Scenario: The API confirms the save before the screen does @AC-5', () => {
    it('Then the POST to /api/registrations answers 201 with firstName "Jane" and a createdAt value, and the client reports it saved', async () => {
      const fetcher = fetchAnswering(contractResponse(201, example(201)))
      await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'saved', firstName: 'Jane' })
    })

    it('And the response contains no row id — the contract refuses a 201 that carries one', () => {
      const ref = operation.responses['201'].content['application/json'].schema.$ref
      expect(conforms(ref, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })).toEqual([])
      expect(conforms(ref, { id: 1, firstName: 'Jane', createdAt: '2026-10-20T14:03:27Z' })).not.toEqual([])
      expect(conforms(ref, { firstName: 'Jane', createdAt: '2026-10-20T14:03:27.123Z' })).not.toEqual([])
    })

    it('a 201 whose body cannot be read is still a saved visit, so the visitor is not sent to register twice', async () => {
      const fetcher = fetchAnswering(new Response('not json', { status: 201, headers: { 'Content-Type': 'application/json' } }))
      await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'saved' })
    })

    it('a 201 without a string firstName yields no name, never a non-string one', async () => {
      const fetcher = fetchAnswering(new Response(JSON.stringify({ firstName: 7 }), { status: 201 }))
      await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'saved' })
    })

    it('only a 201 counts as saved: any status IF-2 does not document is a failed save', async () => {
      for (const status of [200, 202, 204, 302, 404, 405, 502, 503]) {
        const fetcher = fetchAnswering(new Response(null, { status }))
        await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'saveFailed', status })
      }
    })
  })

  describe('Scenario: The confirmation on screen is the only acknowledgement @AC-6', () => {
    it('Then the Network panel shows one request for the submission, to the same-origin /api/registrations', async () => {
      const fetcher = fetchAnswering(contractResponse(201, example(201)))
      await postRegistration(jane, fetcher)
      expect(fetcher).toHaveBeenCalledTimes(1)
      const [url, init] = fetcher.mock.calls[0]
      expect(url).toBe('/api/registrations')
      expect(registrationsPath).toBe('/api/registrations')
      expect(init?.method).toBe('POST')
    })

    it('But no request goes to any other host — the path is relative, so it can only reach the page’s origin', () => {
      expect(registrationsPath.startsWith('/')).toBe(true)
      expect(registrationsPath.startsWith('//')).toBe(false)
      expect(registrationsPath).not.toContain(':')
    })

    it('the request carries no cookie and is never cached, and its body is exactly what IF-2 accepts', async () => {
      const fetcher = fetchAnswering(contractResponse(201, example(201)))
      await postRegistration({ ...jane, firstName: ' Jane ', phone: '(415) 555-0132' }, fetcher)
      const init = fetcher.mock.calls[0][1] as RequestInit
      expect(init.credentials).toBe('omit')
      expect(init.cache).toBe('no-store')
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
      const body = JSON.parse(init.body as string) as unknown
      expect(body).toEqual({ firstName: ' Jane ', lastName: 'Doe', email: 'jane.doe@example.com', phone: '(415) 555-0132' })
      expect(conforms(operation.requestBody.content['application/json'].schema.$ref, body)).toEqual([])
    })

    it('uses the browser’s fetch when none is given', async () => {
      const fetcher = fetchAnswering(contractResponse(201, example(201)))
      vi.stubGlobal('fetch', fetcher)
      await expect(postRegistration(jane)).resolves.toEqual({ kind: 'saved', firstName: 'Jane' })
      expect(fetcher).toHaveBeenCalledTimes(1)
    })
  })

  describe('every other status IF-2 documents', () => {
    it('the client handles exactly the statuses the contract lists', () => {
      expect(Object.keys(operation.responses).sort()).toEqual(['201', '400', '403', '413', '415', '429', '500'])
    })

    it('a 400 maps each field’s server-sent messages, verbatim, to that field only', async () => {
      const body = example(400, 'phone') as { fields: { phone: string[] } }
      const fetcher = fetchAnswering(contractResponse(400, body))
      await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'invalid', fieldErrors: { phone: body.fields.phone[0] } })
    })

    it('a 400 joins several messages for one field and flags several fields', async () => {
      const body = { error: 'validation', fields: { firstName: ['First message.', 'Second message.'], email: ['Email <message>.'] } }
      const fetcher = fetchAnswering(contractResponse(400, body))
      await expect(postRegistration(jane, fetcher)).resolves.toEqual({
        kind: 'invalid',
        fieldErrors: { firstName: 'First message. Second message.', email: 'Email <message>.' },
      })
    })

    it('a 400 with fields {} (malformed JSON) yields fieldErrors with no field flagged', async () => {
      const fetcher = fetchAnswering(contractResponse(400, example(400, 'malformed')))
      const outcome = await postRegistration(jane, fetcher)
      expect(outcome).toEqual({ kind: 'invalid', fieldErrors: {} })
    })

    it('a 400 with an empty message list flags nothing for that field', async () => {
      const fetcher = fetchAnswering(contractResponse(400, { error: 'validation', fields: { lastName: [] } }))
      await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'invalid', fieldErrors: {} })
    })

    it('a 400 whose body cannot be read flags no field', async () => {
      for (const raw of ['not json', 'null', '{"error":"validation"}', '{"error":"validation","fields":{"phone":"text"}}']) {
        const fetcher = fetchAnswering(new Response(raw, { status: 400, headers: { 'Content-Type': 'application/problem+json' } }))
        await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'invalid', fieldErrors: {} })
      }
    })

    for (const status of [403, 413, 415, 429, 500]) {
      it(`a ${status} is a failed save`, async () => {
        const fetcher = fetchAnswering(contractResponse(status, example(status)))
        await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'saveFailed', status })
      })
    }

    it('a network failure is a failed save, never a thrown error', async () => {
      const fetcher = fetchAnswering(new TypeError('Failed to fetch'))
      await expect(postRegistration(jane, fetcher)).resolves.toEqual({ kind: 'saveFailed' })
    })
  })
})
