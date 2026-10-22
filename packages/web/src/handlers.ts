// SCR-1 — the field event handlers, kept out of App so they run without a DOM. The phone
// field reformats as typed or pasted and keeps the caret where the edit left it (ST-8 AC-4–AC-6).
import { editPhone, phoneKey, type PhoneEdit, type PhoneTarget } from './phone.js'
import type { FieldName, FormAction } from './reducer.js'

/** Where the next render must put the phone caret; null once it is placed. */
export interface CaretRef {
  current: number | null
}

interface ChangeEventLike {
  readonly target: { readonly value: string; readonly selectionStart: number | null }
}

interface KeyEventLike {
  readonly key: string
  readonly currentTarget: PhoneTarget
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly metaKey?: boolean
  readonly nativeEvent?: { readonly isComposing?: boolean }
  preventDefault(): void
}

function setPhone(edit: PhoneEdit, dispatch: (action: FormAction) => void, caret: CaretRef): void {
  caret.current = edit.caret
  dispatch({ type: 'change', field: 'phone', value: edit.value })
}

/** The change handler for one field: the phone keeps only its digits, formatted; the others take what was typed. */
export function changeHandler(field: FieldName, dispatch: (action: FormAction) => void, caret: CaretRef) {
  return ({ target: { value, selectionStart } }: ChangeEventLike): void => {
    if (field === 'phone') setPhone(editPhone(value, selectionStart ?? value.length), dispatch, caret)
    else dispatch({ type: 'change', field, value })
  }
}

/** The keydown handler for the phone: Backspace or Delete next to a separator deletes the digit beyond it. */
export function phoneKeyDownHandler(dispatch: (action: FormAction) => void, caret: CaretRef) {
  return (event: KeyEventLike): void => {
    const modified = Boolean(event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent?.isComposing)
    const edit = phoneKey(event.key, event.currentTarget, modified)
    if (edit === undefined) return
    event.preventDefault()
    setPhone(edit, dispatch, caret)
  }
}

/** Move focus to the field Submit flagged, once its error is rendered and described (ST-8 AC-2). */
export function restoreFocus(
  pending: { current: FieldName | null },
  inputs: Partial<Record<FieldName, Pick<HTMLInputElement, 'focus'> | null>>,
): void {
  if (pending.current === null) return
  inputs[pending.current]?.focus()
  pending.current = null
}

/** Place the pending caret in the phone input after the reformatted value has rendered. */
export function restoreCaret(caret: CaretRef, input: Pick<HTMLInputElement, 'setSelectionRange'> | null | undefined): void {
  if (caret.current === null || !input) return
  input.setSelectionRange(caret.current, caret.current)
  caret.current = null
}
