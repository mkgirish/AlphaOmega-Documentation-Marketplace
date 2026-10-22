// AD-3 — the rules and messages live only in CMP-2. This guard fails if a registration
// message is copied into the API or screen sources instead of imported from @app/shared.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registrationMessages } from './index.js'

const root = fileURLToPath(new URL('../../..', import.meta.url))

function sourcesContaining(text: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-F', '-e', text, '--', 'packages/api/src', 'packages/web/src', ':!*.test.ts', ':!*.test.tsx'],
      { cwd: root, encoding: 'utf8' },
    )
    return out.split('\n').filter(Boolean)
  } catch (error) {
    // git grep exits 1 when nothing matches; anything else is a real failure.
    if ((error as { status?: number }).status === 1) return []
    throw error
  }
}

describe('AD-3 git-grep guard', () => {
  const messages = [...new Set(Object.values(registrationMessages).flatMap((m) => Object.values(m)))]

  it('has messages to guard', () => {
    expect(messages.length).toBeGreaterThan(0)
  })

  it.each(messages)('no API or screen source redefines %j', (message) => {
    expect(sourcesContaining(message)).toEqual([])
  })
})
