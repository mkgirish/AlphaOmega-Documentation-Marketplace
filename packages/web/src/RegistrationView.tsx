import type { FormEvent } from 'react'
import { fields } from './fields.js'
import type { FieldName, FormState } from './reducer.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

export interface RegistrationViewProps {
  readonly state: FormState
  readonly onChange: (field: FieldName, value: string) => void
  readonly onSubmit: () => void
}

// SCR-1 — the registration screen as the kiosk opens it: one card, the four visitor fields
// and Submit, nothing to navigate to. A flagged field shows the server's message directly
// under its input, tied to it by aria-describedby; a 201 replaces the form with the
// confirmation.
export function RegistrationView({ state, onChange, onSubmit }: RegistrationViewProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
        <h1 id="registration-title" className="text-2xl font-semibold">
          Visitor registration
        </h1>
        {state.status === 'confirmed' ? (
          <p id="confirmation" role="status" tabIndex={-1} className="mt-6 text-lg">
            Thank you, {state.confirmedName}. You are registered.
          </p>
        ) : (
          <>
            <p id="registration-intro" className="mt-2 text-muted">
              Please register. All fields are required.
            </p>
            {state.status === 'saveFailed' ? (
              <p id="save-error" role="alert" className="mt-4 font-medium text-danger">
                Your registration could not be saved. Please try again.
              </p>
            ) : null}
            <form
              className="mt-6 flex flex-col gap-5"
              aria-labelledby="registration-title"
              aria-describedby="registration-intro"
              autoComplete="off"
              noValidate
              onSubmit={submit}
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
                      onChange={(event) => onChange(field.name, event.target.value)}
                      className={`${control} min-h-11 border ${error ? 'border-danger' : 'border-edge'} bg-surface px-3 py-2 text-ink`}
                    />
                    {error ? (
                      <p id={`${field.name}-error`} className="text-sm text-danger">
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
                id="submit"
                type="submit"
                aria-disabled={state.submitting ? true : undefined}
                className={`${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong${state.submitting ? ' cursor-wait' : ''}`}
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
