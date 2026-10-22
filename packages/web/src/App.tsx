import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { fields } from './fields.js'
import { focusFirstError, initialState, reducer, type FormState } from './reducer.js'
import { createSubmit, focusTargetIn, onSubmitWith } from './submit.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** The ids that describe an input: its error first (when flagged), then its hint. */
const describedBy = (...ids: (string | false | undefined)[]): string | undefined => ids.filter(Boolean).join(' ') || undefined

// SCR-1 — the registration screen as the kiosk opens it: one card, the four visitor fields
// and Submit, nothing to navigate to. Submit sends to IF-2; a refusal shows each field's
// message under its input with focus on the first (ST-11 AC-6).
export function App({ initial = initialState }: { initial?: FormState } = {}) {
  const [state, dispatch] = useReducer(reducer, initial)
  const latest = useRef(state)
  const submit = useMemo(() => createSubmit({ getState: () => latest.current, dispatch }), [])

  useLayoutEffect(() => {
    latest.current = state
  }, [state])

  // Focus moves once the errors have rendered, so the input's description is read with it.
  useEffect(() => focusFirstError(state, focusTargetIn(document)), [state])

  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
        <h1 id="registration-title" className="text-2xl font-semibold">
          Visitor registration
        </h1>
        <p id="registration-intro" className="mt-2 text-muted">
          Please register. All fields are required.
        </p>
        {state.status === 'saved' ? (
          <p id="confirmation" role="status" className="mt-4 font-medium">
            Thank you, {state.confirmedName}. You are registered.
          </p>
        ) : null}
        {state.status === 'saveFailed' ? (
          <p id="save-failed" role="alert" className="mt-4 font-medium text-danger">
            Your registration could not be saved. Please try again.
          </p>
        ) : null}
        <form
          className="mt-6 flex flex-col gap-5"
          aria-labelledby="registration-title"
          aria-describedby="registration-intro"
          autoComplete="off"
          noValidate
          onSubmit={onSubmitWith(submit)}
        >
          {fields.map((field, index) => {
            const error = state.errors[field.name]
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
                  aria-invalid={error ? true : undefined}
                  aria-describedby={describedBy(error && `${field.name}-error`, field.hint && `${field.name}-hint`)}
                  value={state.values[field.name]}
                  onChange={(event) => dispatch({ type: 'change', field: field.name, value: event.target.value })}
                  className={`${control} min-h-11 border ${error ? 'border-danger' : 'border-edge'} bg-surface px-3 py-2 text-ink`}
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
          <button
            type="submit"
            aria-disabled={state.submitting ? true : undefined}
            className={`${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong`}
          >
            Submit
          </button>
        </form>
      </section>
    </main>
  )
}
