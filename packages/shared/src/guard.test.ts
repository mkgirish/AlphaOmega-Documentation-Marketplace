// AD-3 guard: the registration rules and copy live only in CMP-2. Every other package
// imports them from @app/shared; a literal copy in packages/api or packages/web fails here.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { confirmation, fieldMessages } from './index.js'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function gitGrep(literal: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-n', '-F', '-e', literal, '--', 'packages/api/src', 'packages/web/src', ':(exclude)*.test.ts', ':(exclude)*.test.tsx'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    )
    return out.split('\n').filter(Boolean)
  } catch (err) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if ((err as { status?: number }).status === 1) return []
    throw err
  }
}

const guarded = [
  confirmation.heading('').replace('!', ''),
  confirmation.body,
  confirmation.registerAnother,
  confirmation.pageTitle,
  confirmation.submitting,
  ...Object.values(fieldMessages).flatMap((m) => Object.values(m)),
]

describe('AD-3 git-grep guard', () => {
  it('guards a non-empty list of shared strings', () => {
    expect(guarded.length).toBeGreaterThan(5)
    for (const s of guarded) expect(s.trim().length).toBeGreaterThan(3)
  })

  it.each(guarded)('%j is defined only in packages/shared', (literal) => {
    expect(gitGrep(literal)).toEqual([])
  })

  it('holds no copy of the NANP or control-character rules outside packages/shared', () => {
    expect(gitGrep('[2-9]\\d{2}')).toEqual([])
    expect(gitGrep('\\u202e')).toEqual([])
  })
})
