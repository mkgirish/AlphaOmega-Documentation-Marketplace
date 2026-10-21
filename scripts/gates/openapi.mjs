// Gate: openapi-regenerated (scaffold placeholder).
// The real job regenerates packages/api/openapi.json from the Fastify route schemas
// and `git diff --exit-code` proves the committed file matches. Until routes exist the
// generator is a no-op: it leaves the committed file untouched, so the diff is clean.
import { existsSync } from 'node:fs'

const committed = new URL('../../packages/api/openapi.json', import.meta.url)
if (!existsSync(committed)) {
  console.error('openapi-regenerated: packages/api/openapi.json is missing.')
  process.exit(1)
}
console.log('openapi-regenerated: scaffold placeholder — no routes yet; committed openapi.json left unchanged. OK')
process.exit(0)
