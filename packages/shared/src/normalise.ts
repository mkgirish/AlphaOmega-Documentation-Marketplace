// CMP-2 — the one normalisation both sides apply, kept apart so every module can import it.
/** Trim and collapse internal whitespace before validating or storing. */
export function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
