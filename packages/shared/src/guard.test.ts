// AD-3 guard: the registration rules and their wording live only in packages/shared.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fieldMessages } from './index.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))

const sources = ['packages/api/src', 'packages/web/src']
const notTests = [':!**/*.test.*', ':!**/*.spec.*', ':!**/__tests__/**', ':!**/test/**']

/** `git grep` over the api and web source, tracked or not, tests excluded; [] when nothing matches. */
function grepOutsideShared(flag: '-F' | '-E', needles: readonly string[]): string[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '--untracked', '-n', flag, ...needles.flatMap((needle) => ['-e', needle]), '--', ...sources, ...notTests],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    return out.split('\n').filter(Boolean)
  } catch (error) {
    if ((error as { status?: number }).status === 1) return []
    throw new Error(`the AD-3 guard needs git grep in a git checkout: ${(error as Error).message}`)
  }
}

const ruleWording = Object.values(fieldMessages).flatMap((m) => (typeof m === 'string' ? [m] : Object.values(m)))

describe('AD-3 git-grep guard', () => {
  it('finds no zod import outside packages/shared', () => {
    expect(grepOutsideShared('-E', ['[\'"]zod(/[^\'"]*)?[\'"]'])).toEqual([])
  })

  it('finds the field messages defined only in packages/shared', () => {
    expect(ruleWording).toContain('Enter your first name.')
    expect(grepOutsideShared('-F', ruleWording)).toEqual([])
  })

  it('reports a match when one exists outside packages/shared', () => {
    expect(grepOutsideShared('-F', ['@app/shared']).length).toBeGreaterThan(0)
  })
})
