import { useReducer, useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { fields } from './fields.js'
import { initialState, reducer, type FieldName, type FormState } from './reducer.js'
import { createSubmitter, sendRegistration } from './submit.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

/** The ids that describe a field: its error first, then its hint. */
function describedBy(name: FieldName, hint: boolean, error: boolean): string | undefined {
  const ids = [error ? `${name}-error` : '', hint ? `${name}-hint` : ''].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

export interface RegistrationFormProps {
  readonly state: FormState
  readonly onChange: (field: FieldName, value: string) => void
  readonly onSubmit: () => void
}

// SCR-1 — the registration screen as the kiosk opens it: one card, the four visitor fields
// and Submit, nothing to navigate to. The API's field errors show under their fields (ST-11).
export function RegistrationForm({ state, onChange, onSubmit }: RegistrationFormProps) {
  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
        <h1 id="registration-title" className="text-2xl font-semibold">
          Visitor registration
        </h1>
        <p id="registration-intro" className="mt-2 text-muted">
          Please register. All fields are required.
        </p>
        <form
          className="mt-6 flex flex-col gap-5"
          aria-labelledby="registration-title"
          aria-describedby="registration-intro"
          autoComplete="off"
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            onSubmit()
          }}
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
                  aria-invalid={error === undefined ? undefined : true}
                  aria-describedby={describedBy(field.name, field.hint !== undefined, error !== undefined)}
                  value={state.values[field.name]}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className={`${control} min-h-11 border border-edge bg-surface px-3 py-2 text-ink`}
                />
                {error === undefined ? null : (
                  <p id={`${field.name}-error`} className="text-sm font-medium text-danger">
                    {error}
                  </p>
                )}
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
            className={`${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong`}
          >
            Submit
          </button>
        </form>
      </section>
    </main>
  )
}

// The screen's wiring: one reducer, one submitter. Each dispatch is flushed before focus
// moves, so the field is announced together with its error.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [submit] = useState(() =>
    createSubmitter({
      send: (values) => sendRegistration(values),
      dispatch: (action) => flushSync(() => dispatch(action)),
      focus: (field) => document.getElementById(field)?.focus(),
    }),
  )

  return (
    <RegistrationForm
      state={state}
      onChange={(field, value) => dispatch({ type: 'change', field, value })}
      onSubmit={() => void submit(state.values)}
    />
  )
}
