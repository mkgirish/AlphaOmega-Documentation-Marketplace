// SCR-1 — what pressing Submit does. The form is judged by the shared rules first; a flagged
// field takes focus so its message is read out. Sending the registration lands with its story.
import { flushSync } from 'react-dom'
import { fieldErrors, fieldNames, type FormAction, type FormState } from './reducer.js'

export interface SubmitEvent {
  preventDefault(): void
  readonly currentTarget: HTMLFormElement
}

export function submit(event: SubmitEvent, values: FormState['values'], dispatch: (action: FormAction) => void): void {
  event.preventDefault()
  const errors = fieldErrors(values)
  const first = fieldNames.find((name) => errors[name] !== undefined)
  if (first === undefined) return
  // Render the message first, so the focused field is announced with it.
  flushSync(() => dispatch({ type: 'failed', errors }))
  const control = event.currentTarget.elements.namedItem(first) as HTMLElement | null
  control?.focus()
}
