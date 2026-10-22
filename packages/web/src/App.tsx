import { useLayoutEffect, useReducer, useRef } from 'react'
import { control, Field } from './Field.js'
import { fields } from './fields.js'
import { changeHandler, phoneKeyDownHandler, restoreCaret, restoreFocus, type CaretRef } from './handlers.js'
import { initialState, reducer, type FieldName } from './reducer.js'
import { submitForm } from './submit.js'

// SCR-1 — the registration screen as the kiosk opens it: one card, the four visitor fields
// and Submit, nothing to navigate to. Submit flags an invalid phone (ST-8); sending lands with its story.
export function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({})
  const caret = useRef<number | null>(null) satisfies CaretRef
  const focus = useRef<FieldName | null>(null)

  // Once the render lands, put the caret back where the phone edit left it (ST-8 AC-6) and focus
  // the field Submit flagged, so its error is rendered and described when focus arrives.
  useLayoutEffect(() => {
    restoreCaret(caret, inputs.current.phone)
    restoreFocus(focus, inputs.current)
  })

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
          onSubmit={(event) => {
            event.preventDefault()
            submitForm(state.values, dispatch, (field) => {
              focus.current = field
            })
          }}
        >
          {fields.map((field, index) => (
            <Field
              key={field.name}
              field={field}
              value={state.values[field.name]}
              error={state.errors[field.name]}
              autoFocus={index === 0}
              inputRef={(input) => {
                inputs.current[field.name] = input
              }}
              onChange={changeHandler(field.name, dispatch, caret)}
              onKeyDown={field.name === 'phone' ? phoneKeyDownHandler(dispatch, caret) : undefined}
            />
          ))}
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
