// Value formatting shared by the rules and the API: whitespace and UTC timestamps.

/** Compose to NFC, trim and collapse internal whitespace before validating or storing. */
export function normalise(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

/** Format a Date (or epoch milliseconds) as whole UTC seconds, ISO-8601 with a Z. */
export function formatUtcSeconds(at: Date | number): string {
  const ms = typeof at === 'number' ? at : at.getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}
