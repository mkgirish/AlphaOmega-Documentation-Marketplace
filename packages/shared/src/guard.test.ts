import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { messages } from './index.js'

// AD-3 — every registration message is defined once, in CMP-2. A copy of a message in
// packages/api or packages/web source means a second rule that can drift from this one.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

function git(args: string[]): { stdout: string; status: number | null } {
  const run = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  return { stdout: run.stdout, status: run.status }
}

describe('AD-3 git-grep guard', () => {
  it('finds the phone message and every other fixed message defined nowhere outside packages/shared source', () => {
    expect(git(['rev-parse', '--is-inside-work-tree']), 'the guard needs a git work tree').toEqual({ stdout: 'true\n', status: 0 })
    const fixed = Object.entries(messages).flatMap(([key, message]) => (typeof message === 'string' ? [[key, message] as const] : []))
    expect(fixed.map(([key]) => key)).toContain('invalidPhone')
    for (const [key, message] of fixed) {
      // git grep exits 1 when nothing matches, 0 when something does; --untracked also searches new files.
      const grep = git([
        'grep',
        '--untracked',
        '-n',
        '-F',
        '-e',
        message,
        '--',
        'packages',
        ':!packages/shared',
        ':!*.test.ts',
        ':!*.test.tsx',
      ])
      expect(grep, `messages.${key} copied outside packages/shared`).toEqual({ stdout: '', status: 1 })
    }
  })
})
