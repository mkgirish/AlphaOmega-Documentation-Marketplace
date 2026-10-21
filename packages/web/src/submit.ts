// ST-3 — pressing Submit. The browser never validates (the form is noValidate, AC-4); an
// empty field stops the Submit before anything is sent, and focus moves to the first empty
// field (AC-1, AC-3).
import { flushSync } from 'react-dom'
import type { FormAction, FormState } from './reducer.js'
import { firstFlagged, missingFields } from './validation.js'

/** The slice of a form submit event the handler reads; React's FormEvent satisfies it. */
export interface SubmitEventLike {
  preventDefault(): void
  readonly currentTarget: { readonly elements: { namedItem(name: string): unknown } }
}

const focusable = (target: unknown): target is { focus(): void } =>
  typeof target === 'object' && target !== null && 'focus' in target && typeof target.focus === 'function'

export function handleSubmit(event: SubmitEventLike, values: FormState['values'], dispatch: (action: FormAction) => void): void {
  event.preventDefault()
  const errors = missingFields(values)
  const first = firstFlagged(errors)
  if (first === undefined) return
  // Render the messages first, so the field is already invalid and described when focus
  // lands on it and a screen reader reads its message with its label.
  flushSync(() => dispatch({ type: 'invalid', errors }))
  const target = event.currentTarget.elements.namedItem(first)
  if (focusable(target)) target.focus()
}
