// Gate: contracts-honoured (scaffold placeholder).
// Builders replace this with the real provider/consumer contract tests against
// contracts/IF-2.json. Here it only asserts the committed contract is present and is
// valid JSON, so the home is real before any provider or consumer exists.
import { readFileSync } from 'node:fs'

try {
  const raw = readFileSync(new URL('../../contracts/IF-2.json', import.meta.url), 'utf8')
  JSON.parse(raw)
  console.log('contracts-honoured: scaffold placeholder — contracts/IF-2.json present and valid JSON. OK')
  process.exit(0)
} catch (err) {
  console.error('contracts-honoured: contracts/IF-2.json missing or invalid:', err.message)
  process.exit(1)
}
