import { useLayoutEffect, useReducer, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { fields } from './fields.js'
import { phoneChange, phoneKey, type PhoneEdit } from './phone.js'
import { initialState, reducer, type FieldName, type FormState } from './reducer.js'
import { createSubmitter } from './submit.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

// SCR-1 — the registration screen as the kiosk opens it: one card, the four visitor fields
// and Submit, nothing to navigate to. Submit flags what is wrong under each field (ST-8)
// and sends only a valid form; the confirmation replaces the form after a 201.
export function App({ initial = initialState }: { initial?: FormState } = {}) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [submit] = useState(() =>
    createSubmitter({
      send: (input, init) => fetch(input, init),
      dispatch,
      focus: (field: FieldName) => document.getElementById(field)?.focus(),
    }),
  )
  const phone = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const confirmation = useRef<HTMLParagraphElement>(null)

  // Keep the caret after the digit it followed once the phone is reformatted (ST-8 AC-6).
  useLayoutEffect(() => {
    if (caret.current !== null) phone.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })

  useLayoutEffect(() => {
    if (state.saved !== null) confirmation.current?.focus()
  }, [state.saved])

  const editPhone = (edit: PhoneEdit) => {
    caret.current = edit.caret
    dispatch({ type: 'change', field: 'phone', value: edit.value })
  }

  const onChange = (name: FieldName, event: ChangeEvent<HTMLInputElement>) => {
    const { value, selectionStart } = event.target
    if (name === 'phone') editPhone(phoneChange(value, selectionStart ?? value.length))
    else dispatch({ type: 'change', field: name, value })
  }

  const onPhoneKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // Word deletes and IME composition stay the browser's own.
    if (event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return
    const { value, selectionStart, selectionEnd } = event.currentTarget
    const edit = phoneKey(event.key, value, selectionStart ?? value.length, selectionEnd ?? value.length)
    if (edit === null) return
    event.preventDefault()
    editPhone(edit)
  }

  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
        <h1 id="registration-title" className="text-2xl font-semibold">
          Visitor registration
        </h1>
        {state.saved !== null ? (
          <p id="registration-confirmation" ref={confirmation} role="status" tabIndex={-1} className="mt-6 text-lg">
            Thank you, {state.saved}. You are registered.
          </p>
        ) : (
          <>
            <p id="registration-intro" className="mt-2 text-muted">
              Please register. All fields are required.
            </p>
            <form
              className="mt-6 flex flex-col gap-5"
              aria-labelledby="registration-title"
              aria-describedby="registration-intro"
              autoComplete="off"
              noValidate
              aria-busy={state.submitting ? true : undefined}
              onSubmit={(event) => {
                event.preventDefault()
                void submit(state.values)
              }}
            >
              {fields.map((field, index) => {
                const error = state.errors[field.name]
                const describedBy = [error ? `${field.name}-error` : '', field.hint ? `${field.name}-hint` : ''].filter(Boolean).join(' ')
                return (
                  <div key={field.name} className="flex flex-col gap-1">
                    <label htmlFor={field.name} className="font-medium">
                      {field.label}
                    </label>
                    <input
                      id={field.name}
                      ref={field.name === 'phone' ? phone : undefined}
                      name={field.name}
                      type={field.type}
                      inputMode={field.inputMode}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus={index === 0}
                      required
                      aria-invalid={error ? true : undefined}
                      aria-describedby={describedBy || undefined}
                      value={state.values[field.name]}
                      onChange={(event) => onChange(field.name, event)}
                      onKeyDown={field.name === 'phone' ? onPhoneKey : undefined}
                      className={`${control} min-h-11 border bg-surface px-3 py-2 text-ink ${error ? 'border-danger' : 'border-edge'}`}
                    />
                    {error ? (
                      <p id={`${field.name}-error`} className="text-sm font-medium text-danger">
                        {error}
                      </p>
                    ) : null}
                    {field.hint ? (
                      <p id={`${field.name}-hint`} className="text-sm text-muted">
                        {field.hint}
                      </p>
                    ) : null}
                  </div>
                )
              })}
              {state.saveFailed ? (
                <p id="save-failed" role="alert" className="text-sm font-medium text-danger">
                  Sorry, your registration could not be saved. Please try again.
                </p>
              ) : null}
              <button
                type="submit"
                aria-disabled={state.submitting ? true : undefined}
                className={`${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong`}
              >
                Submit
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
