// AD-3 guard: the registration rules and messages live only in CMP-2. Neither the screen
// nor the API may restate a message or reach for zod to define field rules of its own.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fieldMessages } from './index.js'

const root = fileURLToPath(new URL('../../..', import.meta.url))

function gitGrep(args: string[]): string[] | undefined {
  try {
    return execFileSync('git', ['grep', '--untracked', '-l', ...args], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else means git is unavailable.
    if ((error as { status?: number }).status === 1) return []
    return undefined
  }
}

const hasGit = gitGrep(['-F', 'registration', '--', 'packages/shared/src']) !== undefined
const consumers = ['packages/web/src', 'packages/api/src', ':!*.test.ts', ':!*.test.tsx']

describe.skipIf(!hasGit)('AD-3 git-grep guard', () => {
  const messages = [...new Set(Object.values(fieldMessages).flatMap((rules) => Object.values(rules)))]

  it('finds the shared messages where they are defined, so the search itself works', () => {
    expect(gitGrep(['-F', fieldMessages.phone.format, '--', 'packages/shared/src'])).toContain('packages/shared/src/registration.ts')
  })

  it.each(messages)('no consumer restates %j', (message) => {
    expect(gitGrep(['-F', message, '--', ...consumers])).toEqual([])
  })

  it('no consumer defines a registration field rule with zod', () => {
    const files = gitGrep(['-E', 'firstName|lastName', '--', ...consumers]) ?? []
    const zod = gitGrep(['-E', 'from [\'"]zod[\'"]', '--', ...consumers]) ?? []
    expect(files.filter((file) => zod.includes(file))).toEqual([])
  })
})
