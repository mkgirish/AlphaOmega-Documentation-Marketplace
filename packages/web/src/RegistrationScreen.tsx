import { fields } from './fields.js'
import type { FieldName, FormState } from './reducer.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

export interface RegistrationScreenProps {
  readonly state: FormState
  readonly onChange: (field: FieldName, value: string) => void
  readonly onSubmit: () => void
  readonly onReset: () => void
}

// SCR-1 — the registration screen for every phase of the reducer: one card, the four
// visitor fields and Submit, or the confirmation once the visit is saved. Nothing to
// navigate to. Field messages are the server's, shown verbatim under their field (ST-10).
export function RegistrationScreen({ state, onChange, onSubmit, onReset }: RegistrationScreenProps) {
  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
        <h1 id="registration-title" className="text-2xl font-semibold">
          Visitor registration
        </h1>
        {state.phase === 'confirmed' ? (
          <div
            id="confirmation"
            aria-labelledby="confirmation-message"
            tabIndex={-1}
            className="mt-6 flex flex-col gap-5 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <p id="confirmation-message" role="status" className="text-lg">
              Thank you, {state.confirmedName}. You are registered.
            </p>
            <button
              type="button"
              onClick={onReset}
              className={`${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong`}
            >
              Register another visitor
            </button>
          </div>
        ) : (
          <>
            <p id="registration-intro" className="mt-2 text-muted">
              Please register. All fields are required.
            </p>
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
                      readOnly={state.submitting}
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
              {state.phase === 'saveFailed' ? (
                <p id="save-failed" role="alert" className="text-danger">
                  Your registration could not be saved. Please try again.
                </p>
              ) : null}
              <button
                id="submit"
                type="submit"
                aria-disabled={state.submitting || undefined}
                className={`${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary ${state.submitting ? 'cursor-wait' : 'hover:bg-primary-strong'}`}
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
