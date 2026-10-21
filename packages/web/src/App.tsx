import { useReducer } from 'react'
import { fields } from './fields.js'
import { initialState, reducer, type FormState } from './reducer.js'
import { handleSubmit } from './submit.js'
import { attentionSummary } from './validation.js'

// The palette's focus ring and touch-target sizes are shared by every control (AC-5, AC-6).
const control = 'block w-full min-w-0 rounded-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'

export interface AppProps {
  /** The reducer's starting state; the kiosk always opens on the empty form. */
  readonly initial?: FormState
}

// SCR-1 — the registration screen as the kiosk opens it: one card, the four visitor fields
// and Submit, nothing to navigate to. A Submit with an empty field is stopped with a message
// under each empty field and a summary box (ST-3); submission lands with its story.
export function App({ initial = initialState }: AppProps = {}) {
  const [state, dispatch] = useReducer(reducer, initial)
  const flagged = fields.filter((field) => state.errors[field.name] !== undefined).length

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
          onSubmit={(event) => handleSubmit(event, state.values, dispatch)}
        >
          {flagged > 0 ? (
            <div id="error-summary" role="alert" className="rounded-md border-2 border-focus bg-surface p-4 font-semibold text-ink">
              {attentionSummary(flagged)}
            </div>
          ) : null}
          {fields.map((field, index) => {
            const error = state.errors[field.name]
            const describedBy = [error === undefined ? '' : `${field.name}-error`, field.hint ? `${field.name}-hint` : '']
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
                  aria-invalid={error === undefined ? undefined : true}
                  aria-describedby={describedBy || undefined}
                  value={state.values[field.name]}
                  onChange={(event) => dispatch({ type: 'change', field: field.name, value: event.target.value })}
                  className={`${control} min-h-11 bg-surface px-3 py-2 text-ink ${error === undefined ? 'border border-edge' : 'border-2 border-focus'}`}
                />
                {error === undefined ? null : (
                  <p id={`${field.name}-error`} className="text-sm font-semibold text-ink">
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
