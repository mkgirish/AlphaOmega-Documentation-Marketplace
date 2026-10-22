import { fields } from './fields.js'
import type { FormAction, FormState } from './reducer.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'
const primaryButton = `${control} min-h-12 bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-strong`

/** The two fixed tab titles: neither ever carries a visitor's value. */
export const titles = { form: 'Visitor registration', confirmed: 'Registration complete' } as const

export interface ScreenProps {
  readonly state: FormState
  readonly dispatch: (action: FormAction) => void
  readonly onSubmit: () => void
}

/** The element that takes focus once the screen reaches the given state; none while saving. */
export function focusTarget(state: FormState): string | undefined {
  switch (state.status) {
    case 'confirmed':
      return 'confirmation-title'
    case 'invalid':
      return fields.find((field) => state.errors[field.name] !== undefined)?.name
    case 'saveFailed':
      return 'form-alert'
    case 'editing':
      return 'firstName'
    default:
      return undefined
  }
}

/** Bring the tab title and focus in line with the state the screen has just reached. */
export function syncScreen(state: FormState, doc: Pick<Document, 'title' | 'getElementById'>): void {
  doc.title = state.status === 'confirmed' ? titles.confirmed : titles.form
  const target = focusTarget(state)
  if (target !== undefined) doc.getElementById(target)?.focus()
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="mr-2 inline-block size-5 animate-spin align-[-0.25em] motion-reduce:animate-none"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.35" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function Confirmation({ firstName, dispatch }: { firstName: string; dispatch: ScreenProps['dispatch'] }) {
  return (
    <section
      id="registration-card"
      className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8"
      aria-labelledby="confirmation-title"
    >
      <h1
        id="confirmation-title"
        tabIndex={-1}
        className="text-2xl font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {`Thank you, ${firstName}!`}
      </h1>
      <p className="mt-2 text-muted">Your visit has been registered.</p>
      <button type="button" className={`mt-6 ${primaryButton}`} onClick={() => dispatch({ type: 'reset' })}>
        Register another visitor
      </button>
    </section>
  )
}

function RegistrationForm({ state, dispatch, onSubmit }: ScreenProps) {
  const saving = state.submitting
  return (
    <section id="registration-card" className="w-full max-w-[480px] rounded-xl border border-edge bg-surface p-6 sm:p-8">
      <h1 id="registration-title" className="text-2xl font-semibold">
        Visitor registration
      </h1>
      <p id="registration-intro" className="mt-2 text-muted">
        Please register. All fields are required.
      </p>
      {state.status === 'saveFailed' ? (
        <div
          id="form-alert"
          role="alert"
          tabIndex={-1}
          className={`mt-4 rounded-md border-2 border-focus px-3 py-2 font-medium ${control}`}
        >
          Your visit could not be saved. Please try again.
        </div>
      ) : null}
      <form
        className="mt-6 flex flex-col gap-5"
        aria-labelledby="registration-title"
        aria-describedby="registration-intro"
        aria-busy={saving ? 'true' : undefined}
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (!saving) onSubmit()
        }}
      >
        {fields.map((field, index) => {
          const error = state.errors[field.name]
          const describedBy = [field.hint ? `${field.name}-hint` : '', error === undefined ? '' : `${field.name}-error`]
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
                readOnly={saving || undefined}
                aria-invalid={error === undefined ? undefined : 'true'}
                aria-describedby={describedBy || undefined}
                value={state.values[field.name]}
                onChange={(event) => dispatch({ type: 'change', field: field.name, value: event.target.value })}
                className={`${control} min-h-11 border border-edge bg-surface px-3 py-2 text-ink`}
              />
              {field.hint ? (
                <p id={`${field.name}-hint`} className="text-sm text-muted">
                  {field.hint}
                </p>
              ) : null}
              {error === undefined ? null : (
                <p id={`${field.name}-error`} className="text-sm font-medium text-ink">
                  {error}
                </p>
              )}
            </div>
          )
        })}
        <button type="submit" aria-disabled={saving ? 'true' : undefined} className={primaryButton}>
          {saving ? (
            <>
              <Spinner />
              Submitting…
            </>
          ) : (
            'Submit'
          )}
        </button>
      </form>
    </section>
  )
}

// SCR-1 — the registration screen: one card on the page, holding either the form or, once
// the API has answered 201, the confirmation in its place. Nothing to navigate to.
export function Screen(props: ScreenProps) {
  return (
    <main className="flex min-h-screen justify-center bg-canvas px-4 py-8 text-ink sm:items-center">
      {props.state.status === 'confirmed' ? (
        <Confirmation firstName={props.state.firstName} dispatch={props.dispatch} />
      ) : (
        <RegistrationForm {...props} />
      )}
    </main>
  )
}
