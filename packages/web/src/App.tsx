import { useLayoutEffect, useReducer, useRef, useState } from 'react'
import { createSubmitter, submitRegistration, type Send } from './client.js'
import { copy } from './copy.js'
import { fields } from './fields.js'
import { initialState, reducer, type FormState } from './reducer.js'
import { focusTargetFor, titleFor } from './screen.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'
// Programmatic focus targets (tabIndex -1) still show where focus is.
const target = 'rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'
const button = `${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong`

interface AppProps {
  /** The state to open in; the kiosk always opens on the empty form. */
  readonly initial?: FormState
  readonly send?: Send
}

// SCR-1 — the registration screen: one card holding either the form or, after a 201, the
// confirmation whose one button hands an empty form to the next visitor without a reload.
export function App({ initial = initialState, send = submitRegistration }: AppProps) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [submit] = useState(() => createSubmitter(send, dispatch))
  const previous = useRef(state)

  // Layout effect: focus moves before paint, so it never passes through <body>.
  useLayoutEffect(() => {
    document.title = titleFor(state)
    const id = focusTargetFor(previous.current, state)
    previous.current = state
    if (id) document.getElementById(id)?.focus()
  }, [state])

  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
        {state.status === 'confirmed' ? (
          <>
            <h1 id="confirmation-title" tabIndex={-1} className={`text-2xl font-semibold ${target}`}>
              {copy.thankYou(state.confirmedName)}
            </h1>
            <p className="mt-2 text-muted">{copy.confirmationBody}</p>
            <button type="button" className={`mt-6 ${button}`} onClick={() => dispatch({ type: 'reset' })}>
              {copy.registerAnother}
            </button>
          </>
        ) : (
          <RegistrationForm state={state} dispatch={dispatch} onSubmit={() => void submit(state.values)} />
        )}
        <output id="announcer" className="sr-only">
          {state.announcement}
        </output>
      </section>
    </main>
  )
}

interface FormProps {
  readonly state: FormState
  readonly dispatch: (action: Parameters<typeof reducer>[1]) => void
  readonly onSubmit: () => void
}

function RegistrationForm({ state, dispatch, onSubmit }: FormProps) {
  const flagged = fields.filter((field) => state.errors[field.name])

  return (
    <>
      <h1 id="registration-title" className="text-2xl font-semibold">
        {copy.formTitle}
      </h1>
      <p id="registration-intro" className="mt-2 text-muted">
        Please register. All fields are required.
      </p>
      {state.status === 'invalid' ? (
        <div
          id="error-summary"
          role="region"
          tabIndex={-1}
          aria-labelledby="error-summary-title"
          className={`mt-6 border-2 border-danger p-4 ${target}`}
        >
          <h2 id="error-summary-title" className="font-semibold">
            {copy.summaryTitle}
          </h2>
          <ul className="mt-2 list-disc pl-5 text-danger">
            {flagged.length > 0 ? (
              flagged.map((field) => <li key={field.name}>{state.errors[field.name]}</li>)
            ) : (
              <li>{copy.summaryFallback}</li>
            )}
          </ul>
        </div>
      ) : null}
      {state.status === 'saveFailed' ? (
        <p id="save-failed" role="alert" className="mt-6 rounded-md border-2 border-danger p-4 font-semibold text-danger">
          {copy.saveFailed}
        </p>
      ) : null}
      <form
        className="mt-6 flex flex-col gap-5"
        aria-labelledby="registration-title"
        aria-describedby="registration-intro"
        aria-busy={state.submitting || undefined}
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        {fields.map((field, index) => {
          const error = state.errors[field.name]
          const describedBy = [field.hint ? `${field.name}-hint` : '', error ? `${field.name}-error` : ''].filter(Boolean).join(' ')
          return (
            <div key={field.name} className="flex flex-col gap-1">
              <label htmlFor={field.name} className="font-medium">
                {field.label}
              </label>
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                inputMode={field.inputMode}
                autoComplete="off"
                spellCheck={false}
                autoFocus={index === 0}
                required
                readOnly={state.submitting}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                value={state.values[field.name]}
                onChange={(event) => dispatch({ type: 'change', field: field.name, value: event.target.value })}
                className={`${control} min-h-11 border bg-surface px-3 py-2 text-ink ${error ? 'border-2 border-danger' : 'border-edge'}`}
              />
              {field.hint ? (
                <p id={`${field.name}-hint`} className="text-sm text-muted">
                  {field.hint}
                </p>
              ) : null}
              {error ? (
                <p id={`${field.name}-error`} className="text-sm font-semibold text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          )
        })}
        <button id="submit-button" type="submit" aria-disabled={state.submitting || undefined} className={button}>
          Submit
        </button>
      </form>
    </>
  )
}
