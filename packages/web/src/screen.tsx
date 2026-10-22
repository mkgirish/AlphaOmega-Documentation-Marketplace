import type { FormEvent } from 'react'
import { fields } from './fields.js'
import type { FieldName, FormState } from './reducer.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

export interface RegistrationScreenProps {
  readonly state: FormState
  readonly onChange: (field: FieldName, value: string) => void
  readonly onSubmit: () => void
}

// SCR-1 — the registration screen as the kiosk opens it: one card, the four visitor fields
// and Submit, nothing to navigate to. A field's error sits directly under its input, in the
// danger colour, tied to it with aria-invalid and aria-describedby (ST-9).
export function RegistrationScreen({ state, onChange, onSubmit }: RegistrationScreenProps) {
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
        <p id="registration-intro" className="mt-2 text-muted">
          Please register. All fields are required.
        </p>
        {state.saved !== null ? (
          <p id="registration-confirmation" role="status" className="mt-4 font-semibold">
            Thank you, {state.saved}. You are registered.
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
            const describedBy = [error !== undefined ? `${field.name}-error` : '', field.hint ? `${field.name}-hint` : '']
              .filter(Boolean)
              .join(' ')
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
                  aria-invalid={error !== undefined ? true : undefined}
                  aria-describedby={describedBy || undefined}
                  value={state.values[field.name]}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className={`${control} min-h-11 ${error !== undefined ? 'border-2 border-danger' : 'border border-edge'} bg-surface px-3 py-2 text-ink`}
                />
                {error !== undefined ? (
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
          {state.saveFailed ? (
            <p id="registration-failed" role="alert" className="font-semibold text-danger">
              We could not save your registration. Please try again.
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
      </section>
    </main>
  )
}
