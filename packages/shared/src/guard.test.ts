// AD-3 guard — the required-field messages live only in CMP-2. Any source file outside
// packages/shared that spells one out has forked the rules; import them instead.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { attentionSummary, requiredMessages } from './index.js'

function gitRoot(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

const root = gitRoot()

/** Source files (tracked or new) holding `text` literally, outside the excluded paths. */
function sourcesContaining(text: string, excludeShared: boolean): string[] {
  const pathspec = ['*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs', ':(exclude)**/*.test.ts', ':(exclude)**/*.test.tsx', ':(exclude)e2e/**']
  if (excludeShared) pathspec.push(':(exclude)packages/shared/**')
  try {
    const out = execFileSync('git', ['grep', '--untracked', '-l', '-F', '-e', text, '--', ...pathspec], { cwd: root, encoding: 'utf8' })
    return out.split('\n').filter(Boolean)
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if ((error as { status?: number }).status === 1) return []
    throw error
  }
}

describe.skipIf(root === undefined)('AD-3 git-grep guard (ST-3)', () => {
  const texts = [...Object.values(requiredMessages), attentionSummary(2).replace(/^2 /, '')]

  it.each(texts)('"%s" is defined in packages/shared', (text) => {
    expect(sourcesContaining(text, false)).toContain('packages/shared/src/index.ts')
  })

  it.each(texts)('"%s" is spelled out nowhere else', (text) => {
    expect(sourcesContaining(text, true)).toEqual([])
  })
})
