// ST-9 — the screen's email check. The rule and the message are CMP-2's (AD-2, AD-3): the
// screen keeps no pattern, length or copy of its own, so it accepts exactly what the API does.
import { messages, normalise, registrationInput } from '@app/shared'

/**
 * The shared email message when the shared rule rejects the value; undefined when it passes.
 * Checked after the shared normalise(), as the API checks it, so stray spaces are not flagged.
 */
export function emailError(value: string): string | undefined {
  return registrationInput.shape.email.safeParse(normalise(value)).success ? undefined : messages.invalidEmail
}
