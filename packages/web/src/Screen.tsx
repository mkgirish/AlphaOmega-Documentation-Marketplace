import { fields } from './fields.js'
import type { FieldName, FormState } from './reducer.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'
const primaryButton = `${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong`

export interface ScreenProps {
  readonly state: FormState
  readonly onChange: (field: FieldName, value: string) => void
  readonly onSubmit: () => void
  readonly onReset: () => void
  /** The polite live region's text; undefined until a visitor has registered, so the first form is calm. */
  readonly announcement?: string
}

// SCR-1 — the registration screen: one card holding either the four visitor fields and
// Submit, or, once the API has answered 201, the confirmation in their place (ST-2).
export function RegistrationScreen({ state, onChange, onSubmit, onReset, announcement }: ScreenProps) {
  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
        {state.status === 'confirmed' ? (
          <Confirmation firstName={state.firstName} onReset={onReset} />
        ) : (
          <RegistrationForm state={state} onChange={onChange} onSubmit={onSubmit} />
        )}
        {/* Rendered from the confirmation on, so the reset's text lands in a region the screen reader already watches. */}
        {announcement === undefined ? null : (
          <p id="announcement" role="status" className="sr-only">
            {announcement}
          </p>
        )}
      </section>
    </main>
  )
}

function Confirmation({ firstName, onReset }: { firstName: string; onReset: () => void }) {
  return (
    <>
      <h1
        id="confirmation-title"
        tabIndex={-1}
        className="rounded-md text-2xl font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {firstName ? `Thank you, ${firstName}!` : 'Thank you!'}
      </h1>
      <p className="mt-2 text-muted">Your visit has been registered.</p>
      <button type="button" onClick={onReset} className={`${primaryButton} mt-6`}>
        Register another visitor
      </button>
    </>
  )
}

function RegistrationForm({ state, onChange, onSubmit }: Omit<ScreenProps, 'onReset' | 'announcement'>) {
  const submitting = state.status === 'submitting'
  return (
    <>
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
                readOnly={submitting || undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                value={state.values[field.name]}
                onChange={(event) => onChange(field.name, event.target.value)}
                className={`${control} min-h-11 bg-surface px-3 py-2 text-ink ${error ? 'border-3 border-ink' : 'border border-edge'}`}
              />
              {field.hint ? (
                <p id={`${field.name}-hint`} className="text-sm text-muted">
                  {field.hint}
                </p>
              ) : null}
              {error ? (
                <p id={`${field.name}-error`} className="text-sm font-medium text-ink">
                  {error}
                </p>
              ) : null}
            </div>
          )
        })}
        {submitting ? (
          <p role="status" className="sr-only">
            Submitting…
          </p>
        ) : null}
        {state.status === 'saveFailed' ? (
          <p role="alert" className="rounded-md border border-edge px-3 py-2 font-medium">
            Your visit could not be saved. Please try again.
          </p>
        ) : null}
        <button
          type="submit"
          aria-disabled={submitting || undefined}
          className={`${primaryButton} inline-flex items-center justify-center gap-2`}
        >
          {submitting ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block size-4 animate-spin rounded-full border-2 border-on-primary border-t-transparent motion-reduce:animate-none"
              />
              Submitting…
            </>
          ) : (
            'Submit'
          )}
        </button>
      </form>
    </>
  )
}
