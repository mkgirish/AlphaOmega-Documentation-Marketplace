// Gate: migration-committed (scaffold placeholder).
// Builders replace this with the check that every schema change is a generated,
// committed drizzle-kit SQL migration under packages/api/drizzle. The initial
// migration is committed; with no further schema changes the check passes.
import { existsSync } from 'node:fs'

const dir = new URL('../../packages/api/drizzle/', import.meta.url)
if (!existsSync(dir)) {
  console.error('migration-committed: packages/api/drizzle is missing.')
  process.exit(1)
}
console.log('migration-committed: scaffold placeholder — drizzle migrations directory present. OK')
process.exit(0)
